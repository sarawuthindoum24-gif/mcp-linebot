import assert from "node:assert/strict";
import test from "node:test";

test("scheduled report uploads one flat file and sends its link once", async () => {
  const priorDeno = globalThis.Deno;
  const priorFetch = globalThis.fetch;
  let handler;
  let claimed = false;
  let teamsCalls = 0;
  let uploadedCsv = "";
  const sentCards = [];
  globalThis.Deno = {
    env: { get: key => ({ DAILY_REPORT_SECRET: "test-secret", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", TEAMS_WEBHOOK_URL: "https://teams.example.test/hook" })[key] },
    serve: fn => { handler = fn; },
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("receiving_report_dispatches?on_conflict")) {
      if (claimed) return Response.json([]);
      claimed = true;
      return Response.json([{ report_date: "test" }]);
    }
    if (target.includes("receiving_report_dispatches?select=status")) return Response.json([{ status: "SENT" }]);
    if (target.includes("receiving_report_dispatches?report_date=")) return Response.json([]);
    if (target.includes("/rest/v1/receiving_issues?")) return Response.json([{
      id: "r1", line_message_id: "receiving-1", message_at: new Date().toISOString(),
      issue_date: new Date().toISOString().slice(0, 10),
      branch: "สาขา ทดสอบ", product: "สินค้าตัวอย่าง", unit: "ถุง",
      variance_type: "INCOMPLETE_RECEIPT", ordered_qty: null, received_qty: null,
      delta_qty: null, reported_missing_qty: 15, reported_action: "ขออนุญาตโอนคืนสินค้า",
      status: "PENDING_REVIEW",
    }]);
    if (target.includes("/rest/v1/line_group_messages?")) return Response.json([{line_message_id:"diagnostic"}]);
    if (target.includes("/rest/v1/receiving_parse_review?")) return Response.json([{line_message_id:"review-1"}]);
    if (target.includes("/rest/v1/line_quality_issues?")) return Response.json([{
      line_message_id: "q1", message_at: new Date().toISOString(), branch: "สาขา ทดสอบ",
      product: "สินค้า", quantity_text: "2 กล่อง", weight_text: null, defect: "ชำรุด",
      supplier: null, lot: null, resolution: null, status: "OPEN",
    }]);
    if (target.includes("/storage/v1/object/sign/")) {
      const path = new URL(target).pathname.replace("/storage/v1", "");
      return Response.json({ signedURL: `${path}?token=private` });
    }
    if (target.includes("/storage/v1/object/")) {
      uploadedCsv = String(init.body);
      return Response.json({ Key: "file" });
    }
    if (target === "https://teams.example.test/hook") {
      teamsCalls++;
      sentCards.push(JSON.parse(init.body));
      return new Response("", { status: 202 });
    }
    throw new Error("Unexpected URL " + target);
  };
  try {
    await import(`./index.ts?test=${Date.now()}`);
    const request = () => new Request("https://example.supabase.co/functions/v1/daily-teams-report", {
      method: "POST", headers: { "x-report-secret": "test-secret", "content-type": "application/json" }, body: "{}",
    });
    const first = await handler(request());
    assert.equal(first.status, 200);
    assert.match(uploadedCsv, /^\uFEFFวันที่รายงาน,/);
    assert.match(uploadedCsv, /Quality,สาขา ทดสอบ,สินค้า,Quality,,,,2,กล่อง/);
    assert.match(uploadedCsv, /Receiving,สาขา ทดสอบ,สินค้าตัวอย่าง,ได้รับไม่ครบ/);
    assert.match(uploadedCsv, /15,ถุง/);
    const action = sentCards[0].attachments[0].content.actions?.[0];
    assert.equal(action?.type, "Action.OpenUrl");
    assert.match(action?.url || "", /\/storage\/v1\/object\/sign\/whservice-daily-reports\//);
    assert.equal(teamsCalls, 1);
    const cardText = sentCards[0].attachments[0].content.body.map(x=>x.text||"").join("\n");
    assert.match(cardText,/Receiving \| ขาด–เกิน–ไม่ได้รับ–ได้รับไม่ครบ: 1 รายการ จาก 1 สาขา/);
    assert.match(cardText,/ได้รับไม่ครบตามที่แจ้ง 15 ถุง/);
    assert.match(cardText,/1 ข้อความต้องตรวจทาน/);
    assert.match(cardText,/Receiving/);
    const second = await handler(request());
    assert.equal((await second.json()).status, "ALREADY_SENT");
    assert.equal(teamsCalls, 1);
  } finally {
    globalThis.Deno = priorDeno;
    globalThis.fetch = priorFetch;
  }
});
