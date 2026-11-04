import assert from "node:assert/strict";
import test from "node:test";

test("one-time WH group report sends a card and a distinct daily CSV once", async () => {
  const oldDeno = globalThis.Deno;
  const oldFetch = globalThis.fetch;
  let handler;
  let claimed = false;
  let teamsCalls = 0;
  let csv = "";
  let card;
  globalThis.Deno = {
    env: { get: key => ({ DAILY_REPORT_SECRET: "test-secret", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", TEAMS_WEBHOOK_URL: "https://teams.example.test/hook" })[key] },
    serve: fn => { handler = fn; },
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("receiving_report_dispatches?report_date=") && target.includes("select=status"))
      return Response.json(claimed ? [{ status: "SENT" }] : []);
    if (target.includes("receiving_report_dispatches?on_conflict")) {
      if (claimed) return Response.json([]);
      claimed = true;
      return Response.json([{ status: "SENDING" }]);
    }
    if (target.includes("receiving_report_dispatches?report_date=")) return Response.json([]);
    if (target.includes("/rest/v1/receiving_issues?")) return Response.json([]);
    if (target.includes("/rest/v1/line_quality_issues?")) return Response.json([{
      line_message_id: "q1", message_at: "2026-11-03T01:00:00Z", branch: "สาขา ก",
      product: "สินค้า", quantity_text: "2 กล่อง", weight_text: null, defect: "ชำรุด",
      supplier: null, lot: null, resolution: null, status: "OPEN",
    }]);
    if (target.includes("/storage/v1/object/sign/")) {
      const path = new URL(target).pathname.replace("/storage/v1", "");
      return Response.json({ signedURL: `${path}?token=private` });
    }
    if (target.includes("/storage/v1/object/")) {
      csv = String(init.body);
      assert.match(target, /WHservice-issues-2026-11-03-TEST-WH-20261104\.csv$/);
      return Response.json({ Key: "file" });
    }
    if (target === "https://teams.example.test/hook") {
      teamsCalls++;
      card = JSON.parse(init.body);
      return new Response("", { status: 202 });
    }
    throw new Error("Unexpected URL " + target);
  };
  try {
    await import(`./index.ts?groupFileTest=${Date.now()}`);
    const request = () => new Request("https://example.supabase.co/functions/v1/daily-teams-report", {
      method: "POST", headers: { "x-report-secret": "test-secret", "content-type": "application/json" },
      body: JSON.stringify({ test_group_file_date: "2026-11-03" }),
    });
    const first = await handler(request());
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, "GROUP_FILE_ACCEPTED_BY_TEAMS_WORKFLOW");
    assert.match(csv, /^\uFEFFวันที่รายงาน,/);
    assert.match(csv, /Quality,สาขา ก,สินค้า,Quality/);
    assert.match(card.attachments[0].content.body[0].text, /ทดสอบรายงานจริง 1 ครั้ง/);
    assert.match(card.attachments[0].content.actions[0].url, /TEST-WH-20261104\.csv/);
    assert.equal(teamsCalls, 1);
    const second = await handler(request());
    assert.equal((await second.json()).status, "GROUP_FILE_ALREADY_ATTEMPTED");
    assert.equal(teamsCalls, 1);
  } finally {
    globalThis.Deno = oldDeno;
    globalThis.fetch = oldFetch;
  }
});
