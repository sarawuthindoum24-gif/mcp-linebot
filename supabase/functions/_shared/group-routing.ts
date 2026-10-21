/** GROUP ROUTING — groupId remains stable even when a LINE group is renamed. */
export type GroupRoute = "UNMAPPED" | "RECEIVING" | "QUALITY";
export function routeFromName(name: string): GroupRoute {
  if (/ตจว|ต่างจังหวัด|วัตถุดิบ|คุณภาพ/i.test(name)) return "QUALITY";
  if (/รับสินค้า|ขาด.?เกิน/i.test(name)) return "RECEIVING";
  return "UNMAPPED";
}
export function routeFromText(text: string): GroupRoute {
  if (/แจ้งปัญหาวัตถุดิบ|ข้อบกพร่อง\s*[:：]|ชื่อซัพ\s*[:：]|วันหมดอายุ\s*[:：]/i.test(text))
    return "QUALITY";
  if (/(?:ยอดสั่ง|สั่ง)\s*[\d,.]+\s*(?:กก|kg|กรัม|ชิ้น|ลัง|กล่อง|ถุง)/i.test(text) ||
      /รับขาด|รับเกิน|แจ้งปัญหาการรับสินค้า/i.test(text))
    return "RECEIVING";
  return "UNMAPPED";
}
export interface QualityRecord {
  branch: string | null;
  product: string | null;
  supplier: string | null;
  lot: string | null;
  quantity_text: string | null;
  weight_text: string | null;
  defect: string | null;
  resolution: string | null;
}
export function parseQualityMessage(raw: string): QualityRecord {
  // Never invent absent fields. Also keep the original text for human review.
  const items = raw.replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const fields = new Map<string,string>();
  for (const line of items) {
    const hit = line.match(/^(?:\d{1,2}[.)]\s*)?([^:：]+?)\s*[:：]\s*(.*)$/);
    if (hit) fields.set(hit[1].trim().replace(/\s+/g,""),hit[2].trim());
  }
  const first = (...keys:string[]) => {
    for (const key of keys) {
      const val = fields.get(key);
      if (val) return val.slice(0,1000);
    }
    return null;
  };
  return {
    branch: first("สาขา"),
    product: first("ชื่อสินค้า","สินค้า"),
    supplier: first("ชื่อซัพพลายเออร์","ชื่อซัพ","ซัพพลายเออร์","Supplier","ผู้ผลิต"),
    lot: first("Lotหรือวันที่ผลิต","Lot","เลขล็อต","Lotหรือวันผลิต","ผลิตวันที่","วันที่ผลิต"),
    quantity_text: first("จำนวน","จำนวนสินค้า"),
    weight_text: first("น้ำหนัก","น้ำหนักสินค้า"),
    defect: first("ข้อบกพร่องหรือปัญหา","ข้อบกพร่อง","ปัญหา","ลักษณะปัญหา"),
    resolution: first("การจัดการ","แนวทางแก้ไข","การดำเนินการ","วิธีแก้ไข"),
  };
}
