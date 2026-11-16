import { parseReceivingMessage } from "./parser.ts";
const epoch = Date.parse("2026-09-21T04:00:00Z");
Deno.test("over 3% excluded at the boundary while even a tiny shortage is recorded", () => {
  const r = parseReceivingMessage(
    "สาขา จตุจักรชลบุรีขออนุญาตแจ้งปัญหาการรับสินค้า ขาดเกิน\nวันที่ 21/9/69\n"+
    "- ปลาหมึกกรอบ ยอดสั่ง 100 กก.ได้รับจริง 103 กก.\n"+
    "- ปลาหมึกสด ยอดสั่ง 100 กก.ได้รับจริง 99.9 กก.\n"+
    "- ปลา ยอดสั่ง 100 กก.ได้รับจริง 103.1 กก.",
    epoch,
  );
  if (r.branch !== "จตุจักรชลบุรี" || r.issue_date !== "2026-09-21" ||
      r.items.length !== 2 || r.unparsed_lines !== 0 ||
      r.items[0].delta_qty !== -0.1 || r.items[1].delta_qty !== 3.1) {
    throw new Error(JSON.stringify(r));
  }
});
Deno.test("over 3% and any shortage are recorded with correct sign", () => {
  const r = parseReceivingMessage(
    "สาขา ลาดพร้าวแจ้งปัญหา\n- หมู ยอดสั่ง 20 กก.ได้รับจริง 26 กก.\n- ไก่ ยอดสั่ง 30 กก.ได้รับจริง 23 กก.",
    epoch,
  );
  if (r.items.length !== 2 || r.items[0].delta_qty !== 6 || r.items[0].variance_type !== "OVER" ||
      r.items[1].delta_qty !== -7 || r.items[1].variance_type !== "SHORT") throw new Error(JSON.stringify(r));
});
Deno.test("gram quantities are normalized to kg and over 3% is reported", () => {
  const r = parseReceivingMessage("สาขา A แจ้งปัญหา\n- สินค้า ยอดสั่ง 1000 กรัม ได้รับจริง 7000 กรัม", epoch);
  if (r.items.length !== 1 || r.items[0].unit !== "kg" || r.items[0].delta_qty !== 6) throw new Error(JSON.stringify(r));
});
Deno.test("counted-item shortages have zero tolerance too", () => {
  const r = parseReceivingMessage("สาขา A แจ้งปัญหา\n- ตะกร้า ยอดสั่ง 12 ชิ้น ได้รับจริง 10 ชิ้น", epoch);
  if (r.items.length !== 1 || r.items[0].delta_qty !== -2) throw new Error(JSON.stringify(r));
});
Deno.test("unclear lines are review-only, without invented quantities", () => {
  const r = parseReceivingMessage("สาขา A แจ้งปัญหา\n- หมู ยอดสั่ง 25 ได้รับจริง 30", epoch);
  if (r.items.length !== 0 || r.unparsed_lines !== 1) throw new Error(JSON.stringify(r));
});

Deno.test("numbered and wrapped LINE receiving report is parsed without guessing", () => {
  const r = parseReceivingMessage(
    "สาขารัชดา18\nขออนุญาตแจ้งปัญหาการรับสินค้าขาดเกิน\n"+
    "1. เนื้อออสเตรเลีย สั่ง174.1กก\nรับ169.5กก. รับขาด4.6กก.\n"+
    "2.สามชั้น สั่ง100กก.รับ97.1ขาด2.9กก.\n"+
    "3. หมู สั่ง120กก.\nรับ113กก. รับขาด7กก.",
    epoch,
  );
  if (r.branch !== "รัชดา18" || r.items.length !== 3 ||
      r.items[0].delta_qty !== -4.6 || r.items[1].delta_qty !== -2.9 ||
      r.items[2].product !== "หมู" || r.items[2].delta_qty !== -7 ||
      r.unparsed_lines !== 0) throw new Error(JSON.stringify(r));
});
Deno.test("missing item is explicit zero, and count difference remains", () => {
  const r = parseReceivingMessage(
    "สาขา A แจ้งปัญหา\n"+
    "1. ข่า ยอดสั่ง1กก ไม่ได้รับสินค้า โอนคืน1กก. (โอนคืนเรียบร้อยครับ)\n"+
    "2. ตะกร้า สั่ง12ชิ้น รับ10ชิ้น",
    epoch,
  );
  if (r.items.length !== 2 || r.items[0].product !== "ข่า" ||
      r.items[0].delta_qty !== -1 || r.items[1].product !== "ตะกร้า" ||
      r.items[1].delta_qty !== -2 || r.unparsed_lines !== 0) throw new Error(JSON.stringify(r));
});
Deno.test("unit inferred from declared variance, not from thin air", () => {
  const r = parseReceivingMessage(
    "สาขา A แจ้งปัญหา\n"+
    "1. สามชั้น สั่ง130.8 รับ132.6 เกิน1.8กก.\n"+
    "2. หมู สั่ง100 รับ106 เกิน6กก.\n"+
    "3. สินค้า สั่ง25 รับ31",
    epoch,
  );
  if (r.items.length !== 1 || r.items[0].delta_qty !== 6 ||
      r.items[0].unit !== "kg" || r.unparsed_lines !== 1) throw new Error(JSON.stringify(r));
});

Deno.test("3% rule also applies to counted items; zero ordered positive receipt is an issue", () => {
  const r = parseReceivingMessage(
    "สาขา A แจ้งปัญหา\n"+
    "- ตะกร้า ยอดสั่ง 100 ชิ้น ได้รับจริง 103 ชิ้น\n"+
    "- ช้อน ยอดสั่ง 100 ชิ้น ได้รับจริง 104 ชิ้น\n"+
    "- ถุง ยอดสั่ง 10 ถุง ได้รับจริง 9 ถุง\n"+
    "- กล่อง ยอดสั่ง 0 กล่อง ได้รับจริง 1 กล่อง",
    epoch,
  );
  if (r.items.length !== 3 || r.items[0].product !== "ช้อน" ||
    r.items[0].delta_qty !== 4 || r.items[1].delta_qty !== -1 ||
    r.items[2].delta_qty !== 1 || r.unparsed_lines !== 0) throw Error(JSON.stringify(r));
});
Deno.test("fractional overage below threshold is accepted, above threshold reported", () => {
  const r = parseReceivingMessage(
    "สาขา A แจ้งปัญหา\n"+
    "- หมู ยอดสั่ง 100 กก. ได้รับจริง 102.999 กก.\n"+
    "- วัว ยอดสั่ง 100 กก. ได้รับจริง 103 กก.\n"+
    "- ไก่ ยอดสั่ง 100 กก. ได้รับจริง 103.001 กก.\n"+
    "- ปลา ยอดสั่ง 100 กก. ได้รับจริง 99.999 กก.",
    epoch,
  );
  if (r.items.length !== 2 || r.items[0].product !== "ไก่" ||
      r.items[0].delta_qty !== 3.001 || r.items[1].delta_qty !== -0.001)
    throw Error(JSON.stringify(r));
});

Deno.test("system balance vs actual receipt is a weighed shortage (bullet message)", () => {
  const raw = [
    "สาขาเดอะสตรีทรัชดา",
    "ขออนุญาตโอนคืน",
    "- เนื้อวัวออสเตรเลีย 3.3 กก.",
    "เนื่องจากได้รับจริง128.4กก.",
    "ในระบบ131.7กก.",
    "ขอบคุณค่ะ",
  ].join("\n");
  const r=parseReceivingMessage(raw,Date.parse("2026-11-14T23:09:19Z"));
  if (r.branch!=="เดอะสตรีทรัชดา" || r.items.length!==1 ||
      r.items[0].product!=="เนื้อวัวออสเตรเลีย" ||
      r.items[0].ordered_qty!==131.7 || r.items[0].received_qty!==128.4 ||
      r.items[0].delta_qty!==-3.3 || r.items[0].variance_type!=="SHORT" ||
      r.items[0].unit!=="kg" || r.unparsed_lines!==0)
    throw new Error(JSON.stringify(r));
});

Deno.test("system balance vs actual receipt supports unbulleted follow-up", () => {
  const raw = [
    "สาขาเดอะสตรีทรัชดา",
    "ขออนุญาตโอนคืน",
    "เนื้อวัวออสเตรเลีย 3.6 กก.",
    "เนื่องจากได้รับจริง 118.2 กก.",
    "ในระบบ 121.8 กก.",
  ].join("\n");
  const r=parseReceivingMessage(raw,Date.parse("2026-11-15T19:10:00Z"));
  if (r.items.length!==1 || r.items[0].delta_qty!==-3.6 ||
      r.items[0].ordered_qty!==121.8 || r.items[0].received_qty!==118.2)
    throw new Error(JSON.stringify(r));
});

Deno.test("system vs actual amount must both be known; avoid inferred incident", () => {
  const r=parseReceivingMessage(
    "สาขาเดอะสตรีทรัชดา\nขออนุญาตโอนคืน\n- เนื้อวัวออสเตรเลีย 3.3 กก.\nในระบบ131.7กก.",
    epoch);
  if(r.items.length!==0) throw new Error(JSON.stringify(r));
});

Deno.test("do not turn a bare ยอดสั่ง label into a fake product named ยอด", () => {
  const r=parseReceivingMessage(
    "สาขา พระราม 2 ขออนุญาตแจ้งปัญหา\nยอดสั่ง 70 กก. รับจริง 72.5 กก.",
    epoch);
  if (r.items.some(x=>x.product==="ยอด" || x.product==="ยอดสั่ง"))
    throw Error(JSON.stringify(r));
});

Deno.test("wrapped order and received labels retain the actual product name", () => {
  const raw="สาขา พระราม 2 ขออนุญาตแจ้งปัญหา\n"+
    "เนื้อสันคอ\nยอดสั่ง 50 กก\nรับจริง 53.2 กก";
  const r=parseReceivingMessage(raw,epoch);
  if(r.items.length!==1||r.items[0].product!=="เนื้อสันคอ"||
     r.items[0].delta_qty!==3.2)throw Error(JSON.stringify(r));
});
