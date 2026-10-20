import { parseReceivingMessage } from "./parser.ts";
const epoch = Date.parse("2026-09-21T04:00:00Z");
Deno.test("both 5kg examples are not stored", () => {
  const r = parseReceivingMessage(
    "สาขา จตุจักรชลบุรีขออนุญาตแจ้งปัญหาการรับสินค้า ขาดเกิน\nวันที่ 21/9/69\n- ปลาหมึกกรอบ ยอดสั่ง 25 กก.ได้รับจริง 30 กก.ส่วนต่าง 5 กก.\n- ปลาหมึกสด ยอดสั่ง 30 กก.ได้รับจริง 25 กก.ส่วนต่าง 5 กก.",
    epoch,
  );
  if (r.branch !== "จตุจักรชลบุรี" || r.issue_date !== "2026-09-21" || r.items.length !== 0 || r.unparsed_lines !== 0) {
    throw new Error(JSON.stringify(r));
  }
});
Deno.test("more than 5kg is kept and sign correct", () => {
  const r = parseReceivingMessage(
    "สาขา ลาดพร้าวแจ้งปัญหา\n- หมู ยอดสั่ง 20 กก.ได้รับจริง 26 กก.\n- ไก่ ยอดสั่ง 30 กก.ได้รับจริง 23 กก.",
    epoch,
  );
  if (r.items.length !== 2 || r.items[0].delta_qty !== 6 || r.items[0].variance_type !== "OVER" ||
      r.items[1].delta_qty !== -7 || r.items[1].variance_type !== "SHORT") throw new Error(JSON.stringify(r));
});
Deno.test("6000 grams discrepancy is retained as 6 kilograms", () => {
  const r = parseReceivingMessage("สาขา A แจ้งปัญหา\n- สินค้า ยอดสั่ง 1000 กรัม ได้รับจริง 7000 กรัม", epoch);
  if (r.items.length !== 1 || r.items[0].unit !== "kg" || r.items[0].delta_qty !== 6) throw new Error(JSON.stringify(r));
});
Deno.test("counts do not use the 5kg exclusion", () => {
  const r = parseReceivingMessage("สาขา A แจ้งปัญหา\n- ตะกร้า ยอดสั่ง 12 ชิ้น ได้รับจริง 10 ชิ้น", epoch);
  if (r.items.length !== 1 || r.items[0].delta_qty !== -2) throw new Error(JSON.stringify(r));
});
Deno.test("unclear lines are review-only, without invented quantities", () => {
  const r = parseReceivingMessage("สาขา A แจ้งปัญหา\n- หมู ยอดสั่ง 25 ได้รับจริง 30", epoch);
  if (r.items.length !== 0 || r.unparsed_lines !== 1) throw new Error(JSON.stringify(r));
});
