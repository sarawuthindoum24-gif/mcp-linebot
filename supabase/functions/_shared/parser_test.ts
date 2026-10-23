import { parseReceivingMessage } from "./parser.ts";
const epoch = Date.parse("2026-10-21T04:00:00Z");

function parse(lines: string[]) {
  return parseReceivingMessage(["สาขา จตุจักรชลบุรีแจ้งปัญหาการรับสินค้า",
    "วันที่ 21/10/69", ...lines].join("\n"), epoch);
}

Deno.test("every shortage is retained, including 0.001 kg", () => {
  const result = parse([
    "- หมู ยอดสั่ง 20 กก. ได้รับจริง 19.999 กก.",
    "- ผัก ยอดสั่ง 12 ชิ้น ได้รับจริง 11 ชิ้น",
    "- ไก่ ยอดสั่ง 1 ถุง ไม่ได้รับสินค้า",
  ]);
  if (result.branch !== "จตุจักรชลบุรี" ||
      result.issue_date !== "2026-10-21" ||
      result.items.length !== 3 ||
      result.items.some(item => item.variance_type !== "SHORT") ||
      result.items[0].delta_qty !== -0.001 ||
      result.items[2].received_qty !== 0) throw new Error(JSON.stringify(result));
});

Deno.test("overage at 3 percent is allowed and above it is retained", () => {
  const result = parse([
    "- กุ้ง ยอดสั่ง 100 กก. ได้รับจริง 103 กก.",
    "- ปลา ยอดสั่ง 100 กก. ได้รับจริง 103.001 กก.",
    "- ตะกร้า ยอดสั่ง 100 ชิ้น ได้รับจริง 104 ชิ้น",
  ]);
  if (result.items.length !== 2 ||
      result.items[0].delta_qty !== 3.001 ||
      result.items[1].delta_qty !== 4 ||
      result.items.some(item => item.variance_type !== "OVER"))
    throw new Error(JSON.stringify(result));
});

Deno.test("grams normalize to kilograms while preserving a small shortage", () => {
  const result = parse(["- เนื้อ ยอดสั่ง 1000 กรัม ได้รับจริง 999 กรัม"]);
  if (result.items.length !== 1 || result.items[0].unit !== "kg" ||
      result.items[0].delta_qty !== -0.001) throw new Error(JSON.stringify(result));
});

Deno.test("unclear units go to review without inventing quantities", () => {
  const result = parse(["- หมู ยอดสั่ง 25 ได้รับจริง 20"]);
  if (result.items.length !== 0 || result.unparsed_lines !== 1)
    throw new Error(JSON.stringify(result));
});
