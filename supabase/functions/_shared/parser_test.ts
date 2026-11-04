import { parseReceivingMessage } from "./parser.ts";
const epoch = Date.parse("2026-10-21T04:00:00Z");

function parse(lines: string[]) {
  return parseReceivingMessage(["สาขา จตุจักรชลบุรีแจ้งปัญหาการรับสินค้า",
    "วันที่ 21/10/69", ...lines].join("\n"), epoch);
}

Deno.test("weighted differences within plus or minus 3 kg are accepted; count differences remain reportable", () => {
  const result = parse([
    "- หมู ยอดสั่ง 20 กก. ได้รับจริง 17 กก.",
    "- ปลา ยอดสั่ง 20 กก. ได้รับจริง 23 กก.",
    "- ผัก ยอดสั่ง 12 ชิ้น ได้รับจริง 11 ชิ้น",
    "- ไก่ ยอดสั่ง 1 ถุง ไม่ได้รับสินค้า",
  ]);
  if (result.branch !== "จตุจักรชลบุรี" ||
      result.issue_date !== "2026-10-21" ||
      result.items.length !== 2 ||
      result.items[0].variance_type !== "SHORT" ||
      result.items[1].variance_type !== "NOT_RECEIVED" ||
      result.items[0].delta_qty !== -1 ||
      result.items[1].received_qty !== 0) throw new Error(JSON.stringify(result));
});

Deno.test("weighted shortage and overage above 3 kg are retained regardless of percentage", () => {
  const result = parse([
    "- กุ้ง ยอดสั่ง 100 กก. ได้รับจริง 96.999 กก.",
    "- ปลา ยอดสั่ง 1000 กก. ได้รับจริง 1003.001 กก.",
    "- ตะกร้า ยอดสั่ง 100 ชิ้น ได้รับจริง 101 ชิ้น",
  ]);
  if (result.items.length !== 3 ||
      result.items[0].delta_qty !== -3.001 || result.items[0].variance_type !== "SHORT" ||
      result.items[1].delta_qty !== 3.001 || result.items[1].variance_type !== "OVER" ||
      result.items[2].delta_qty !== 1 || result.items[2].variance_type !== "OVER")
    throw new Error(JSON.stringify(result));
});

Deno.test("grams normalize to kilograms and use the 3 kg boundary", () => {
  const result = parse(["- เนื้อ ยอดสั่ง 10000 กรัม ได้รับจริง 6999 กรัม"]);
  if (result.items.length !== 1 || result.items[0].unit !== "kg" ||
      result.items[0].delta_qty !== -3.001) throw new Error(JSON.stringify(result));
});

Deno.test("unclear units go to review without inventing quantities", () => {
  const result = parse(["- หมู ยอดสั่ง 25 ได้รับจริง 20"]);
  if (result.items.length !== 0 || result.unparsed_lines !== 1)
    throw new Error(JSON.stringify(result));
});

Deno.test("explicitly not received weighted goods are reported even below 3 kg", () => {
  const result = parse(["- พริก ยอดสั่ง 1 กก. ไม่ได้รับสินค้า",
    "- ผัก ยอดสั่ง 2 กก. รับจริง 0 กก.",
    "- เนื้อ ยอดสั่ง 3 กก. ไม่ได้รับเลย"]);
  if (result.items.length !== 3 || result.items.some(x => x.variance_type !== "NOT_RECEIVED") ||
      result.items[0].ordered_qty !== 1 || result.items[0].received_qty !== 0 ||
      result.items[0].delta_qty !== -1) throw new Error(JSON.stringify(result));
});

Deno.test("unbulleted multi-product report uses issue date and keeps only weight differences above 3 kg", () => {
  const raw=["สาขาพระราม 2 ขออนุญาตแจ้งปัญหาการรับสินค้า ขาด/เกิน",
    "วันที่แจ้ง 03/11/69",
    "สินค้า ก", "ยอดสั่ง 100 กก", "รับจริง 102 กก", "เกิน 2 กก",
    "สินค้า ข", "ยอดสั่ง 130 กก", "รับจริง 134.70 กก", "เกิน 4.70 กก",
    "สินค้า ค", "ยอดสั่ง 70 กก", "รับจริง 73.50 กก", "เกิน 3.50 กก"].join("\n");
  const result=parseReceivingMessage(raw,Date.parse("2026-11-04T02:00:00Z"));
  if (result.branch!=="พระราม 2" || result.issue_date!=="2026-11-03" ||
      result.items.length!==2 || result.items[0].product!=="สินค้า ข" ||
      result.items[0].delta_qty!==4.7 || result.items[1].delta_qty!==3.5)
    throw new Error(JSON.stringify(result));
});

Deno.test("reported incomplete count is retained without inventing ordered or received totals", () => {
  const raw=["สาขา ทดสอบ", "ขออนุญาตโอนคืนสินค้า", "",
    "- สินค้าตัวอย่าง 15 ถุง", "", "เนื่องจากหน้าสาขาได้รับสินค้าไม่ครบค่ะ"].join("\n");
  const result=parseReceivingMessage(raw,Date.parse("2026-11-04T13:22:23Z"));
  const item=result.items[0];
  if (result.items.length!==1 || item.variance_type!=="INCOMPLETE_RECEIPT" ||
      item.branch!=="ทดสอบ" || item.product!=="สินค้าตัวอย่าง" ||
      item.reported_missing_qty!==15 || item.unit!=="ถุง" ||
      item.ordered_qty!==null || item.received_qty!==null || item.delta_qty!==null ||
      item.reported_action!=="ขออนุญาตโอนคืนสินค้า") throw new Error(JSON.stringify(result));
});
