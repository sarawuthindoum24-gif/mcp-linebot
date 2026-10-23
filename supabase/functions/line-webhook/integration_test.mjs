import assert from "node:assert/strict";
import { after, test } from "node:test";

// Signed synthetic events exercise the deployed handler shape and REST routing.
const secret = "synthetic-line-secret-for-tests-only";
const registry = new Map();
const messages = new Map();
const issues = new Map();
const quality = new Map();
const reviews = new Map();
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
  const table = url.pathname.split("/").at(-1);
  const method = options.method;
  if (table === "line_group_registry" && method === "GET") {
    const id = url.searchParams.get("group_id")?.slice(3);
    return Response.json(registry.has(id) ? [registry.get(id)] : []);
  }
  if (table === "line_group_registry" && method === "POST") {
    const row = JSON.parse(options.body);
    if (!registry.has(row.group_id)) registry.set(row.group_id, row);
    return Response.json(null);
  }
  if (table === "line_group_registry" && method === "PATCH") {
    const id = url.searchParams.get("group_id")?.slice(3);
    Object.assign(registry.get(id), JSON.parse(options.body));
    return Response.json(null);
  }
  if (table === "line_group_messages" && method === "POST") {
    const row = JSON.parse(options.body);
    if (!messages.has(row.line_message_id)) messages.set(row.line_message_id, row);
    return Response.json(null);
  }
  if (table === "receiving_issues" && method === "POST") {
    for (const row of JSON.parse(options.body)) {
      const key = row.line_message_id + ":" + row.line_item_index;
      if (!issues.has(key)) issues.set(key, {...row,is_void:false});
    }
    return Response.json(null);
  }
  if (table === "receiving_parse_review" && method === "POST") {
    const row = JSON.parse(options.body);
    if (!reviews.has(row.line_message_id)) reviews.set(row.line_message_id,row);
    return Response.json(null);
  }
  if (method === "PATCH") {
    const id = url.searchParams.get("line_message_id")?.slice(3);
    const collection = {
      line_group_messages: messages,
      line_quality_issues: quality,
      receiving_issues: issues,
    }[table];
    assert.ok(collection, table);
    for (const row of collection.values())
      if (row.line_message_id === id) Object.assign(row, JSON.parse(options.body));
    return Response.json(null);
  }
  if (table === "receiving_parse_review" && method === "DELETE") {
    reviews.delete(url.searchParams.get("line_message_id")?.slice(3));
    return Response.json(null);
  }
  throw new Error("Unexpected REST request: " + method + " " + table);
};

await import("./index.ts");
after(() => { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; });

async function signedRequest(events, signatureOverride) {
  const body = JSON.stringify({events});
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body)));
  const signature = Buffer.from(digest).toString("base64");
  return handler(new Request("https://example.test/line-webhook",{
    method:"POST",headers:{"x-line-signature":signatureOverride??signature},body,
  }));
}

test("LINE Verify payload succeeds with a valid signature", async () => {
  assert.equal((await signedRequest([])).status,200);
});
test("invalid signature cannot write rows", async () => {
  assert.equal((await signedRequest([{type:"message"}],"invalid")).status,401);
  assert.equal(registry.size,0);
});
test("real group route, quantity rule, retry, and unsend are idempotent", async () => {
  const groupId="synthetic-receiving-group";
  assert.equal((await signedRequest([{type:"join",timestamp:Date.now(),
    source:{type:"group",groupId}}])).status,200);
  assert.equal(registry.get(groupId).route,"UNMAPPED");
  const event={type:"message",timestamp:Date.parse("2026-10-21T04:00:00Z"),
    source:{type:"group",groupId},message:{type:"text",id:"synthetic-message-1",
      text:["สาขา ทดสอบ แจ้งปัญหาการรับสินค้า",
        "- A ยอดสั่ง 100 กก. ได้รับจริง 97 กก.",
        "- B ยอดสั่ง 100 กก. ได้รับจริง 103 กก.",
        "- C ยอดสั่ง 100 กก. ได้รับจริง 103.001 กก.",
        "- D ยอดสั่ง 10 ถุง ไม่ได้รับสินค้า",
      ].join("\n")}};
  assert.equal((await signedRequest([event])).status,200);
  assert.equal(registry.get(groupId).route,"RECEIVING");
  assert.equal(messages.get("synthetic-message-1").route,"RECEIVING");
  assert.deepEqual([...issues.values()].map(x=>x.delta_qty),[-3,3.001,-10]);
  assert.equal((await signedRequest([event])).status,200);
  assert.equal(issues.size,3);
  assert.equal((await signedRequest([{type:"unsend",source:event.source,
    unsend:{messageId:event.message.id}}])).status,200);
  assert.ok([...issues.values()].every(x=>x.is_void===true && x.voided_at));
});
