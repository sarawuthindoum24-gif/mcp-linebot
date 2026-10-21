type Issue = {
  branch: string; product: string; unit: string; delta_qty: number;
  variance_type: "SHORT" | "OVER"; status: string;
};
const encoder = new TextEncoder();
function env(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error("Missing required secret " + key);
  return value;
}
function safeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
async function db(path: string, method = "GET", body?: unknown, prefer?: string): Promise<any> {
  const response = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    method, headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json",
      ...(prefer ? {Prefer:prefer} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error("DB_" + response.status);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function bangkokYesterday() {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit",
  }).formatToParts(new Date());
  const n = (k:string) => Number(p.find(x=>x.type===k)?.value||0);
  const todayLocalMidnightUtc = Date.UTC(n("year"),n("month")-1,n("day"),-7);
  const start = new Date(todayLocalMidnightUtc - 86400000);
  const end = new Date(todayLocalMidnightUtc);
  const localDate = new Date(Date.UTC(n("year"),n("month")-1,n("day"))-86400000).toISOString().slice(0,10);
  return {date:localDate,start:start.toISOString(),end:end.toISOString()};
}
async function loadIssues(start:string,end:string): Promise<Issue[]> {
  const all: Issue[] = [];
  for (let offset=0; offset<=10000; offset+=1000) {
    const params = new URLSearchParams({
      select:"branch,product,unit,delta_qty,variance_type,status",
      message_at:"gte."+start, and:"(message_at.lt."+end+",is_void.eq.false)",
      order:"branch.asc", limit:"1000", offset:String(offset),
    });
    const page = await db("receiving_issues?" + params.toString()) as Issue[];
    all.push(...page);
    if (page.length < 1000) return all;
  }
  throw new Error("REPORT_TOO_LARGE_REQUIRE_PAGINATION");
}
function card(date:string, issues:Issue[]) {
  const byBranch = new Map<string,Issue[]>();
  for (const item of issues) byBranch.set(item.branch,[...(byBranch.get(item.branch)||[]),item]);
  const blocks:any[] = [{
    type:"TextBlock", text:"รายงานปัญหาการรับสินค้า ประจำวันที่ "+date,
    weight:"Bolder", size:"Medium", wrap:true,
  },{
    type:"TextBlock", text:"เวลาไทย 00:00–23:59 | รับขาดทุกจำนวน / รับเกินมากกว่า 3% ของยอดสั่ง",
    wrap:true, isSubtle:true,
  },{
    type:"TextBlock", text:"รวม "+issues.length+" รายการ จาก "+byBranch.size+" สาขา",
    weight:"Bolder", wrap:true,
  }];
  let included = 0;
  for (const [branch, values] of [...byBranch.entries()].sort((a,b)=>a[0].localeCompare(b[0],"th"))) {
    const shortage=values.filter(v=>v.variance_type==="SHORT");
    const over=values.filter(v=>v.variance_type==="OVER");
    const kgShort=shortage.filter(x=>x.unit==="kg").reduce((s,x)=>s+Math.abs(x.delta_qty),0);
    const kgOver=over.filter(x=>x.unit==="kg").reduce((s,x)=>s+x.delta_qty,0);
    const weightShort=shortage.filter(v=>v.unit==="kg");
    const top=values.slice(0,3).map(v=>v.product+" ("+
      (v.variance_type==="SHORT" ? (v.unit==="kg" ? "น้ำหนักชั่งขาด " : "รับขาด ") :
       "รับเกินเกณฑ์ 3% ")+Math.abs(v.delta_qty)+" "+v.unit+")").join(", ");
    const info="รับขาด "+shortage.length+" รายการ (น้ำหนักชั่งขาด "+weightShort.length+
      " รายการ, "+kgShort.toFixed(3)+" กก.) | รับเกินเกณฑ์ 3% "+over.length+
      " รายการ ("+kgOver.toFixed(3)+" กก.)";
    const text=branch+": "+info+"\nสินค้าที่พบ: "+top+(values.length>3?" และอีก "+(values.length-3)+" รายการ":"")+
      "\nข้อเสนอแนะ: ตรวจสอบใบหยิบ/ใบส่งของและหลักฐานรับสินค้า; สาเหตุรอตรวจสอบ";
    if (JSON.stringify(blocks).length+text.length > 22000) break;
    blocks.push({type:"TextBlock", text, wrap:true, separator:true});
    included++;
  }
  if (included < byBranch.size) blocks.push({type:"TextBlock",text:"รายชื่อสาขาบางส่วนถูกย่อเพื่อจำกัดขนาดข้อความ โปรดดูฐานข้อมูล Supabase เพื่อดูข้อมูลทั้งหมด",wrap:true});
  if (!issues.length) blocks.push({type:"TextBlock", text:"ไม่พบรายการปัญหาที่เข้าเกณฑ์ในฐานข้อมูลสำหรับวันนี้ (กรุณายืนยันว่า LINE กลุ่มส่งข้อมูลเข้าระบบก่อนสรุปว่าไม่มีปัญหา)",wrap:true});
  return {type:"message", attachments:[{
    contentType:"application/vnd.microsoft.card.adaptive", contentUrl:null,
    content:{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json",
      type:"AdaptiveCard",version:"1.2",body:blocks},
  }]};
}
Deno.serve(async req=>{
  if (req.method !== "POST") return new Response("Method not allowed",{status:405});
  const reportSecret = Deno.env.get("DAILY_REPORT_SECRET");
  if (!reportSecret) return new Response("Report secret not configured",{status:503});
  if (!safeEqual(req.headers.get("x-report-secret")||"",reportSecret))
    return new Response("Unauthorized",{status:401});
  const day=bangkokYesterday();
  const destination="teams-personal-chat";
  try {
    // Claim first: duplicate invocations do not send twice.
    const claimed=await db("receiving_report_dispatches?on_conflict=report_date,destination","POST",{
      report_date:day.date,destination,status:"SENDING",
    },"resolution=ignore-duplicates,return=representation");
    if (!Array.isArray(claimed)||claimed.length===0) {
      const previous=await db("receiving_report_dispatches?select=status&report_date=eq."+day.date+
        "&destination=eq."+destination+"&limit=1") as Array<{status:string}>;
      if (previous?.[0]?.status==="SENT")
        return Response.json({status:"ALREADY_SENT",date:day.date});
      // A failed/uncertain previous attempt must not become a false CI success.
      return Response.json({status:"PREVIOUS_ATTEMPT_REQUIRES_REVIEW",date:day.date,
        previousStatus:previous?.[0]?.status||"UNKNOWN"},{status:409});
    }
    try {
      const issues=await loadIssues(day.start,day.end);
      // Webhook must be created from a Microsoft Teams Workflows CHAT template, scoped to the requested 1:1 recipient.
      const response=await fetch(env("TEAMS_WEBHOOK_URL"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(card(day.date,issues)),
      });
      if (!response.ok) throw new Error("TEAMS_HTTP_"+response.status);
      await db("receiving_report_dispatches?report_date=eq."+day.date+"&destination=eq."+destination,
        "PATCH",{status:"SENT",updated_at:new Date().toISOString(),error_code:null});
      return new Response(JSON.stringify({status:"SENT",date:day.date,count:issues.length}),{status:200});
    } catch (error) {
      const code=error instanceof Error ? error.message.slice(0,70) : "UNKNOWN";
      await db("receiving_report_dispatches?report_date=eq."+day.date+"&destination=eq."+destination,
        "PATCH",{status:"FAILED",updated_at:new Date().toISOString(),error_code:code});
      throw error;
    }
  } catch (_) {
    console.error("Daily report failed; investigate dispatch status before manual retry.");
    return new Response("Report delivery failed",{status:500});
  }
});
