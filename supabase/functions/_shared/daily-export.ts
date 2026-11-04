export type DailyReceivingIssue = {
  id: string; line_message_id: string; line_item_index: number;
  message_at: string; branch: string; product: string; unit: string;
  ordered_qty: number; received_qty: number; delta_qty: number;
  variance_type: "SHORT" | "OVER"; status: string;
};

export type DailyQualityIssue = {
  line_message_id: string; message_at: string;
  branch: string | null; product: string | null; supplier: string | null;
  lot: string | null; quantity_text: string | null; weight_text: string | null;
  defect: string | null; resolution: string | null; status: string | null;
};

const headings = [
  "วันที่รายงาน", "วันข้อความ (ไทย)", "เวลา (ไทย)", "แหล่งข้อมูล", "สาขา",
  "สินค้า", "ประเภทปัญหา", "ยอดสั่ง", "ยอดรับ", "ส่วนต่างมีเครื่องหมาย",
  "จำนวนขาด/เกิน", "หน่วย", "จำนวนตามข้อความ", "น้ำหนักตามข้อความ",
  "อาการ/ปัญหา", "สาเหตุ", "การจัดการ", "สถานะ", "ผู้ส่งสินค้า", "ล็อต",
  "รหัสรายการ",
];

const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
const localTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text;
  return /[",\r\n]/u.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function quantity(value: string | null): { amount: number | null; unit: string } {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*([\p{L}\p{M}.\s]*)$/u);
  if (!match) return { amount: null, unit: "" };
  const amount = Number(match[1]);
  return { amount: Number.isFinite(amount) ? amount : null, unit: match[2].trim() };
}

export function dailyCsvName(reportDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("INVALID_REPORT_DATE");
  return `WHservice-issues-${reportDate}.csv`;
}

export function buildDailyCsv(
  reportDate: string, receiving: DailyReceivingIssue[], quality: DailyQualityIssue[],
): string {
  dailyCsvName(reportDate);
  const rows: Array<Array<string | number | null>> = [headings];
  for (const item of receiving) {
    const weighted = item.unit === "kg";
    const category = item.variance_type === "SHORT"
      ? (weighted ? "น้ำหนักชั่งขาด" : "รับขาด")
      : (weighted ? "น้ำหนักชั่งเกิน" : "รับเกิน");
    rows.push([
      reportDate, localDate.format(new Date(item.message_at)),
      localTime.format(new Date(item.message_at)), "Receiving", item.branch,
      item.product, category, item.ordered_qty, item.received_qty, item.delta_qty,
      Math.abs(item.delta_qty), item.unit, "", "", "", "ยังไม่ระบุสาเหตุ", "",
      item.status, "", "", item.id,
    ]);
  }
  for (const item of quality) {
    const parsed = quantity(item.quantity_text);
    rows.push([
      reportDate, localDate.format(new Date(item.message_at)),
      localTime.format(new Date(item.message_at)), "Quality", item.branch || "ไม่ระบุสาขา",
      item.product || "ไม่ระบุสินค้า", "Quality", null, null, null,
      parsed.amount, parsed.unit, item.quantity_text || "", item.weight_text || "",
      item.defect || "", "ยังไม่ระบุสาเหตุ", item.resolution || "",
      item.status || "", item.supplier || "", item.lot || "", item.line_message_id,
    ]);
  }
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
