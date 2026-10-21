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
