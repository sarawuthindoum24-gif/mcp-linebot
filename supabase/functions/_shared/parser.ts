/** Deterministic text-only parser. No AI guesses, no storage of rejected raw lines. */
export interface ParsedItem {
  index: number;
  branch: string;
  product: string;
  issue_date: string;
  ordered_qty: number;
  received_qty: number;
  delta_qty: number;
  unit: string;
  variance_type: "SHORT" | "OVER";
}
export interface ParsedMessage {
  branch: string | null;
  issue_date: string;
  items: ParsedItem[];
  unparsed_lines: number;
}

function digits(s: string): string {
  return s.replace(/[๐-๙]/g, c => String("๐๑๒๓๔๕๖๗๘๙".indexOf(c)));
}
function number(s: string): number {
  return Number(digits(s).replace(/,/g, ""));
}
function dateInBangkok(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const find = (t: string) => parts.find(p => p.type === t)?.value || "00";
  return find("year") + "-" + find("month") + "-" + find("day");
}
function messageDate(s: string, fallbackMs: number): string {
  const m = digits(s).match(/วันที่\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/);
  if (!m) return dateInBangkok(fallbackMs);
  let year = Number(m[3]);
  if (year < 100) year += 2500;
  if (year > 2400) year -= 543;
  const month = Number(m[2]), day = Number(m[1]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return dateInBangkok(fallbackMs);
  }
  return d.toISOString().slice(0, 10);
}
function normalizeUnit(unit: string): {kind: "weight" | "count"; unit: string; factor: number} | null {
  const u = unit.toLowerCase().replace(/\./g, "").trim();
  if (u === "กก" || u === "kg") return {kind: "weight", unit: "kg", factor: 1};
  if (u === "กรัม" || u === "g") return {kind: "weight", unit: "kg", factor: 0.001};
  if (["ชิ้น", "ลัง", "กล่อง", "แพ็ค", "ถุง", "ขวด", "แพ็ก", "ห่อ"].includes(u)) return {kind:"count", unit:u, factor:1};
  return null;
}
/** Handles numbered and bulleted multi-line LINE receiving reports. */
export function parseReceivingMessage(raw: string, sentMs: number): ParsedMessage {
  const text = digits(raw).replace(/\r/g, "");
  const header = text.split("\n").map(x => x.trim()).find(Boolean) || "";
  const match = header.match(/^สาขา\s*(.+?)(?:ขออนุญาต|แจ้งปัญหา|มีปัญหา|\s*$)/);
  const branch = match?.[1]?.trim() || null;
  const issue_date = messageDate(text, sentMs);
  const result: ParsedItem[] = [];
  let unparsed_lines = 0;

  const lines = text.split("\n");
  const unitRe = "(กก\\.?|kg\\.?|กรัม|g\\.?|ชิ้น|ลัง|กล่อง|แพ็ค|แพ็ก|ถุง|ขวด|ห่อ)";
  const quantityRe = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const pair = new RegExp(
    "^(.+?)\\s*(?:ยอดสั่ง|สั่ง)\\s*" + quantityRe + "\\s*" + unitRe + "?" +
    "\\s*(?:(?:ได้รับจริง|ได้รับ|รับจริง|รับ)\\s*" + quantityRe + "\\s*" + unitRe + "?|ไม่ได้รับสินค้า)",
    "i",
  );
  // The "short 6 กก." suffix can provide a missing unit, never a missing quantity.
  const statedUnit = new RegExp("(?:ส่วนต่าง|รับขาด|ขาด|เกิน)\\s*" + quantityRe + "\\s*" + unitRe, "i");
  const marker = /^\s*(?:[-•*]\s*|[0-9]{1,3}[.)](?![0-9])\s*)(.+)$/;

  let current: {index: number; lines: string[]} | null = null;
  const flush = () => {
    if (!current) return;
    const combined = current.lines.join(" ").replace(/\s+/g, " ").trim();
    const index = current.index;
    current = null;
    if (!/(?:ยอดสั่ง|สั่ง)/.test(combined)) return;
    const m = combined.match(pair);
    if (!m || !branch) { unparsed_lines++; return; }

    const otherUnit = combined.slice(m[0].length).match(statedUnit)?.[2];
    const explicitOrderedUnit = m[3];
    const explicitReceivedUnit = m[5];
    const defaultUnit = explicitOrderedUnit || explicitReceivedUnit || otherUnit;
    const a = normalizeUnit(explicitOrderedUnit || defaultUnit || "");
    const b = normalizeUnit(explicitReceivedUnit || defaultUnit || "");
    if (!a || !b || a.kind !== b.kind ||
        (a.kind === "count" && a.unit !== b.unit)) {
      unparsed_lines++;
      return;
    }

    const ordered = Math.round(number(m[2]) * a.factor * 1000) / 1000;
    // "ไม่ได้รับสินค้า" is an explicitly stated zero; no inference for unspecified actual amounts.
    const received = m[4] === undefined ? 0 :
      Math.round(number(m[4]) * b.factor * 1000) / 1000;
    const difference = Math.round((received - ordered) * 1000) / 1000;
    if (!Number.isFinite(ordered) || !Number.isFinite(received) ||
        ordered < 0 || received < 0 || !m[1].trim()) {
      unparsed_lines++;
      return;
    }
    if (difference === 0) return;
    if (a.kind === "weight" && Math.abs(difference) <= 5) return;

    result.push({
      index, branch, product: m[1].trim().replace(/[:：-]\s*$/, ""),
      issue_date, ordered_qty: ordered, received_qty: received,
      delta_qty: difference, unit: a.unit,
      variance_type: difference < 0 ? "SHORT" : "OVER",
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(marker);
    if (m) {
      flush();
      current = {index: i + 1, lines: [m[1]]};
    } else if (current && line) {
      current.lines.push(line);
    }
  }
  flush();
  return {branch, issue_date, items: result, unparsed_lines};
}
