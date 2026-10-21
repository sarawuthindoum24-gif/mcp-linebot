import {parseQualityMessage,routeFromName,routeFromText} from "./group-routing.ts";
Deno.test("the two LINE group names route to distinct domains",()=>{
  if (routeFromName("แจ้งปัญหาการรับสินค้า สุกี้ตี๋น้อย")!=="RECEIVING") throw Error("receiving");
  if (routeFromName("รายงานปัญหาต่างจังหวัด (ตจว.)")!=="QUALITY") throw Error("quality");
  if (routeFromText("แจ้งปัญหาวัตถุดิบ")!=="QUALITY") throw Error("quality text");
  if (routeFromText("สาขารัชดา18 1. หมู สั่ง 20 กก รับ 12 กก")!=="RECEIVING")
    throw Error("receiving text");
  if (routeFromText("ทักทายค่ะ")!=="UNMAPPED") throw Error("unknown");
});
Deno.test("extract quality fields from numbered Thai incident without kg exclusion",()=>{
  const s=[
    "แจ้งปัญหาวัตถุดิบ",
    "1. สาขา : แคนวาสสุรินทร์",
    "2. วันที่แจ้ง : 21/10/69",
    "3. ชื่อสินค้า : เนื้อวัว",
    "4. ชื่อซัพ : MENA FOOD",
    "6. Lot หรือวันที่ผลิต : 03/10/2569",
    "7. จำนวน : 1ก้อน",
    "8. น้ำหนัก : 1.530kg",
    "9. ข้อบกพร่อง : เนื้อสีซีดไม่สามารถเสิร์ฟได้",
    "10. แนวทางแก้ไข : ส่งกลับครัวกลางเพื่อตรวจสอบ",
  ].join("\n");
  const q=parseQualityMessage(s);
  if(q.branch!=="แคนวาสสุรินทร์"||q.product!=="เนื้อวัว"||q.supplier!=="MENA FOOD"||
     q.weight_text!=="1.530kg"||!q.defect?.includes("สีซีด")||!q.resolution?.includes("ครัวกลาง"))
    throw Error(JSON.stringify(q));
});

Deno.test("extract fields from actual Terminal 21 Korat LINE quality report",()=>{
  const raw=[
    "แจ้งปัญหาวัตถุดิบ",
    "1. สาขา : เทอร์มินอล 21 โคราช",
    "2. วันที่แจ้ง :21/10/69",
    "3. ชื่อสินค้า : เนื้อวัวสันคอ",
    "4. ชื่อซัพพลายเออร์ : มีนา ฟู๊ด",
    "5. วันที่ได้รับสินค้า : 18/10/69",
    "6. ผลิตวันที่ :09/10/69",
    "   หมดอายุ :08/01/70",
    "7. จำนวน : 1 ก้อน",
    "8. น้ำหนัก : 0.74 Kg",
    "9. ข้อบกพร่องหรือปัญหา :เนื้อวัวสันคอ มีเอ็นแข็งและมันเหลือง ไม่สามารถจัดเสริฟได้",
    "10. การจัดการ : ทำการส่งคืนครัวกลาง ตามรอบส่งเพื่อทำการตรวจสอบ",
  ].join("\n");
  const q=parseQualityMessage(raw);
  if(q.branch!=="เทอร์มินอล 21 โคราช" ||q.product!=="เนื้อวัวสันคอ" ||
    q.supplier!=="มีนา ฟู๊ด" || q.lot!=="09/10/69" ||
    !q.defect?.includes("เอ็นแข็ง") ||!q.resolution?.includes("ส่งคืนครัวกลาง") ||
    q.weight_text!=="0.74 Kg") throw Error(JSON.stringify(q));
});
