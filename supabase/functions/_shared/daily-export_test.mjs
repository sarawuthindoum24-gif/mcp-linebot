import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyCsv, dailyCsvName } from "./daily-export.ts";

test("daily export is a single flat, pivot-ready table with real categories and numbers", () => {
  const csv = buildDailyCsv("2026-11-03", [{
    id: "r1", line_message_id: "line-r1", line_item_index: 0,
    message_at: "2026-11-03T02:03:04Z", branch: "สาขา ก", product: "หมู",
    unit: "kg", ordered_qty: 20, received_qty: 16.999, delta_qty: -3.001,
    variance_type: "SHORT", status: "OPEN",
  }], [{
    line_message_id: "line-q1", message_at: "2026-11-03T05:00:00Z",
    branch: "สาขา ข", product: "=HYPERLINK(\"bad\")", supplier: "ผู้ส่ง",
    lot: "L1", quantity_text: "12 กล่อง", weight_text: "6 กก.",
    defect: "กล่องชำรุด", resolution: "รอตรวจสอบ", status: "OPEN",
  }]);
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^วันที่รายงาน,วันข้อความ \(ไทย\),เวลา \(ไทย\),แหล่งข้อมูล,สาขา,สินค้า,ประเภทปัญหา,/);
  assert.match(lines[1], /Receiving,สาขา ก,หมู,น้ำหนักชั่งขาด,20,16\.999,-3\.001,3\.001,kg,/);
  assert.match(lines[2], /Quality,สาขา ข,"'=HYPERLINK\(""bad""\)",Quality,,,,12,กล่อง,12 กล่อง,6 กก\.,/);
  assert.ok(lines[2].includes("ยังไม่ระบุสาเหตุ"));
  assert.ok(!lines[0].includes("สรุป"));
  assert.equal(dailyCsvName("2026-11-03"), "WHservice-issues-2026-11-03.csv");
});

test("empty Receiving remains zero rows, and counted overage is included", () => {
  const csv = buildDailyCsv("2026-11-03", [{
    id: "r2", line_message_id: "line-r2", line_item_index: 1,
    message_at: "2026-11-03T17:00:00Z", branch: "สาขา ค", product: "สินค้า",
    unit: "ชิ้น", ordered_qty: 100, received_qty: 101, delta_qty: 1,
    variance_type: "OVER", status: "OPEN",
  }], []);
  assert.equal(csv.slice(1).trimEnd().split("\r\n").length, 2);
  assert.match(csv, /รับเกิน,100,101,1,1,ชิ้น,/);
  assert.equal(buildDailyCsv("2026-11-03", [], []).slice(1).trimEnd().split("\r\n").length, 1);
});
