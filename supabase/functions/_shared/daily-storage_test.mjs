import assert from "node:assert/strict";
import test from "node:test";
import { saveDailyFile } from "./daily-storage.ts";

test("uploads a unique private CSV and signs a download link", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(JSON.stringify({ Key: "whservice-daily-reports/WHservice-issues-2026-11-03.csv" }), { status: 200 })
      : new Response(JSON.stringify({ signedURL: "/object/sign/whservice-daily-reports/WHservice-issues-2026-11-03.csv?token=private" }), { status: 200 });
  };
  const link = await saveDailyFile("https://example.supabase.co", "service-key", "2026-11-03", "\uFEFFa,b\r\n", fetcher);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.ok(!("x-upsert" in calls[0].options.headers));
  assert.match(calls[0].options.headers["Content-Type"], /text\/csv/);
  assert.equal(JSON.parse(calls[1].options.body).expiresIn, 90 * 86400);
  assert.equal(new URL(link).searchParams.get("download"), "WHservice-issues-2026-11-03.csv");
  assert.equal(new URL(link).searchParams.get("token"), "private");
});

test("does not sign or send when upload fails", async () => {
  let attempts = 0;
  await assert.rejects(() => saveDailyFile("https://example.supabase.co", "service-key", "2026-11-03", "x", async () => {
    attempts++;
    return new Response("duplicate", { status: 409 });
  }), /STORAGE_UPLOAD_409/);
  assert.equal(attempts, 1);
});

test("one-time group test uploads a separate file without replacing the scheduled file", async () => {
  const calls = [];
  const file = "WHservice-issues-2026-11-03-TEST-WH-20261104.csv";
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? Response.json({ Key: `whservice-daily-reports/${file}` })
      : Response.json({ signedURL: `/object/sign/whservice-daily-reports/${file}?token=private` });
  };
  const link = await saveDailyFile("https://example.supabase.co", "service-key", "2026-11-03", "\uFEFFa,b\r\n", fetcher, "TEST-WH-20261104");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, new RegExp(`${file}$`));
  assert.equal(new URL(link).searchParams.get("download"), file);
});
