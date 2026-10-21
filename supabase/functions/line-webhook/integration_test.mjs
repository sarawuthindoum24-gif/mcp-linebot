import assert from "node:assert/strict";
import { after, test } from "node:test";

// Exercise the deployed handler shape with a synthetic channel secret and an
// in-memory REST stand-in. No real LINE, Supabase, or Teams data is touched.
const secret = "synthetic-line-secret-for-tests-only";
const rows = new Map();
let handler;
const originalFetch = globalThis.fetch;
const originalDeno = globalThis.Deno;

globalThis.Deno = {
  env: { get: key => ({
    LINE_CHANNEL_SECRET: secret,
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  })[key] },
  serve: fn => { handler = fn; },
};
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.origin, "https://supabase.test");
  if (url.pathname.endsWith("/receiving_issues")) {
    if (options.method === "POST") {
      for (const item of JSON.parse(options.body)) {
        const key = `${item.line_message_id}:${item.line_item_index}`;
        if (!rows.has(key)) rows.set(key, { ...item, is_void: false });
      }
      return Response.json(null);
    }
    if (options.method === "PATCH") {
      const messageId = url.searchParams.get("line_message_id")?.slice(3);
      for (const item of rows.values()) {
        if (item.line_message_id === messageId) Object.assign(item, JSON.parse(options.body));
      }
      return Response.json(null);
    }
  }
  if (url.pathname.endsWith("/receiving_parse_review")) return Response.json(null);
  throw new Error(`Unexpected REST request: ${options.method} ${url.pathname}`);
};

await import("./index.ts");
after(() => { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; });

async function signedRequest(events, signatureOverride) {
  const body = JSON.stringify({ events });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const signature = Buffer.from(digest).toString("base64");
  return handler(new Request("https://example.test/line-webhook", {
    method: "POST", headers: { "x-line-signature": signatureOverride ?? signature }, body,
  }));
}

test("LINE Verify payload succeeds with a valid signature", async () => {
  assert.equal((await signedRequest([])).status, 200);
});

test("invalid signature cannot write rows", async () => {
  const before = rows.size;
  assert.equal((await signedRequest([{ type: "message" }], "invalid")).status, 401);
  assert.equal(rows.size, before);
});

test("signed +5/-5 kg are excluded; +6/-6 kg are stored once and unsend voids them", async () => {
  const message = {
    type: "message", timestamp: Date.parse("2026-10-20T03:00:00Z"),
    source: { type: "group", groupId: "synthetic-group" },
    message: { type: "text", id: "synthetic-message-1", text: [
      "สาขา ทดสอบ แจ้งปัญหา",
      "- A ยอดสั่ง 10 กก. ได้รับจริง 15 กก.",
      "- B ยอดสั่ง 15 กก. ได้รับจริง 10 กก.",
      "- C ยอดสั่ง 10 กก. ได้รับจริง 16 กก.",
      "- D ยอดสั่ง 16 กก. ได้รับจริง 10 กก.",
    ].join("\n") },
  };
  assert.equal((await signedRequest([message])).status, 200);
  assert.deepEqual([...rows.values()].map(x => x.delta_qty), [6, -6]);
  assert.equal((await signedRequest([message])).status, 200);
  assert.equal(rows.size, 2);
  assert.equal((await signedRequest([{
    type: "unsend", source: message.source,
    unsend: { messageId: message.message.id },
  }])).status, 200);
  assert.ok([...rows.values()].every(x => x.is_void === true && x.voided_at));
});
