type Issue = {
  branch: string; product: string; unit: string; delta_qty: number;
  ordered_qty: number; received_qty: number;
  variance_type: "SHORT" | "OVER"; status: string;
};
type QualityIssue = {
  branch: string | null; product: string | null;
  quantity_text: string | null; weight_text: string | null; defect: string | null;
};
// Stable LINE group ID of "รายงานปัญหาต่างจังหวัด (ตจว.)".
const UPcountry_QUALITY_GROUP_ID = "C5bc53ddf83debcc8471bfeef0b7caf29";
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
      select:"branch,product,unit,ordered_qty,received_qty,delta_qty,variance_type,status",
      message_at:"gte."+start, and:"(message_at.lt."+end+",is_void.eq.false)",
      order:"branch.asc", limit:"1000", offset:String(offset),
    });
    const page = await db("receiving_issues?" + params.toString()) as Issue[];
    all.push(...page);
    if (page.length < 1000) return all;
  }
  throw new Error("REPORT_TOO_LARGE_REQUIRE_PAGINATION");
}
async function loadQualityIssues(start:string,end:string): Promise<QualityIssue[]> {
  const all: QualityIssue[] = [];
  for (let offset=0; offset<=10000; offset+=1000) {
    const params = new URLSearchParams({
      select:"branch,product,quantity_text,weight_text,defect",
      group_id:"eq."+UPcountry_QUALITY_GROUP_ID,
      message_at:"gte."+start,
      and:"(message_at.lt."+end+",is_void.eq.false)",
      order:"branch.asc",
      limit:"1000", offset:String(offset),
    });
    const page = await db("line_quality_issues?" + params.toString()) as QualityIssue[];
    all.push(...page);
    if (page.length < 1000) return all;
  }
  throw new Error("QUALITY_REPORT_TOO_LARGE_REQUIRE_PAGINATION");
}
function card(date:string, issues:Issue[], quality:QualityIssue[]) {
  const byBranch = new Map<string,Issue[]>();
  for (const item of issues) byBranch.set(item.branch,[...(byBranch.get(item.branch)||[]),item]);
  const qualityByBranch = new Map<string,QualityIssue[]>();
  for (const item of quality) {
    const branch=item.branch?.trim() || "ไม่ระบุสาขา";
    qualityByBranch.set(branch,[...(qualityByBranch.get(branch)||[]),item]);
  }
  const blocks:any[] = [{
    type:"TextBlock", text:"WHservice | รายงาน Receiving และ Quality ประจำวันที่ "+date,
    weight:"Bolder", size:"Medium", wrap:true,
  },{
    type:"TextBlock", text:"ข้อมูลตามเวลารับข้อความ 00:00–23:59 น. (เวลาไทย)",
    wrap:true, isSubtle:true,
  },{
    type:"TextBlock", text:"Receiving | รับขาด–รับเกิน: "+issues.length+
      " รายการ จาก "+byBranch.size+" สาขา",
    weight:"Bolder", wrap:true,
  },{
    type:"TextBlock", text:"รับขาดทุกจำนวน (สินค้าชั่ง: น้ำหนักชั่งขาด) | รับเกินเฉพาะส่วนที่มากกว่า 3% ของยอดสั่ง",
    wrap:true, isSubtle:true,
  }];
  let included = 0;
  for (const [branch, values] of [...byBranch.entries()].sort((a,b)=>a[0].localeCompare(b[0],"th"))) {
    const shortage=values.filter(v=>v.variance_type==="SHORT");
    const over=values.filter(v=>v.variance_type==="OVER");
    const weightShort=shortage.filter(v=>v.unit==="kg");
    const details=values.map(v=>v.product+": สั่ง "+v.ordered_qty+" "+v.unit+
      ", รับ "+v.received_qty+" "+v.unit+" | "+
      (v.variance_type==="SHORT" ? (v.unit==="kg" ? "น้ำหนักชั่งขาด " : "รับขาด ") :
       "รับเกินเกณฑ์ 3% ")+Math.abs(v.delta_qty)+" "+v.unit).join("\n");
    const info="รับขาด "+shortage.length+" รายการ (น้ำหนักชั่งขาด "+weightShort.length+
      " รายการ) | รับเกินเกณฑ์ 3% "+over.length+" รายการ";
    const text=branch+": "+info+"\n"+details+
      "\nสาเหตุ: รอตรวจสอบใบหยิบ/ใบส่งของและหลักฐานรับสินค้า";
    if (JSON.stringify(blocks).length+text.length > 22000) break;
    blocks.push({type:"TextBlock", text, wrap:true, separator:true});
    included++;
  }
  if (included < byBranch.size) blocks.push({type:"TextBlock",text:"รายชื่อสาขาบางส่วนถูกย่อเพื่อจำกัดขนาดข้อความ โปรดดูฐานข้อมูล Supabase เพื่อดูข้อมูลทั้งหมด",wrap:true});
  if (!issues.length) blocks.push({type:"TextBlock",
    text:"ยังไม่ยืนยันการรับข้อความจาก LINE กลุ่มนี้ จึงยังสรุปไม่ได้ว่าไม่มีปัญหารับขาด–รับเกิน",
    wrap:true});
  blocks.push({type:"TextBlock",text:"Quality | กลุ่มต่างจังหวัด: "+quality.length+
    " รายการ จาก "+qualityByBranch.size+" สาขา",weight:"Bolder",wrap:true,separator:true});
  let qualityIncluded=0;
  for (const [branch,values] of [...qualityByBranch.entries()].sort((a,b)=>
    a[0].localeCompare(b[0],"th"))) {
    const details=values.map(v=>(v.product?.trim()||"ไม่ระบุสินค้า")+
      " | จำนวน "+(v.quantity_text?.trim()||"ไม่ระบุ")+
      (v.weight_text?.trim()?" | น้ำหนัก "+v.weight_text.trim():"")+
      "\nปัญหาที่แจ้ง: "+(v.defect?.trim()||"ไม่ระบุ")+
      "\nสาเหตุ: รอตรวจสอบ").join("\n");
    const detail=branch+": "+values.length+" รายการ\n"+details;
    if (JSON.stringify(blocks).length+detail.length > 22000) break;
    blocks.push({type:"TextBlock",text:detail,wrap:true,separator:true});
    qualityIncluded++;
  }
  if (qualityIncluded<qualityByBranch.size) blocks.push({type:"TextBlock",
    text:"รายชื่อสาขา Quality บางส่วนถูกย่อเพื่อจำกัดขนาดข้อความ",wrap:true});
  if (!quality.length) blocks.push({type:"TextBlock",
    text:"ไม่พบรายการ Quality จากกลุ่มต่างจังหวัดในช่วงเวลานี้",wrap:true});
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
  const validGitHubSecret = safeEqual(req.headers.get("x-report-secret")||"",reportSecret);
  let validVaultCronToken = false;
  if (!validGitHubSecret) {
    const cronToken = req.headers.get("x-report-cron-token") || "";
    // A separate 256-bit Vault token permits DB pg_cron without copying
    // DAILY_REPORT_SECRET into cron commands or source control.
    if (/^[a-f0-9]{64}$/.test(cronToken)) {
      try {
        const digestBytes = new Uint8Array(await crypto.subtle.digest(
          "SHA-256",encoder.encode(cronToken)));
        const digestHex = [...digestBytes].map(b => b.toString(16).padStart(2,"0")).join("");
        const config = await db("receiving_cron_auth?select=token_hash&id=eq.1") as
          Array<{token_hash:string}>;
        validVaultCronToken = Boolean(config?.[0] &&
          safeEqual(digestHex,config[0].token_hash));
      } catch (_) {
        console.error("Cron auth lookup failed");
      }
    }
  }
  if (!validGitHubSecret && !validVaultCronToken)
    return new Response("Unauthorized",{status:401});
  // Explicitly requested Teams connectivity test. Never touches the scheduled
  // report's idempotency record and is restricted to one request per local day.
  const requestBody = await req.json().catch(() => ({})) as {
    test_send_once?:boolean; test_real_date?:string; test_combined_date?:string;
    preview_date?:string;
  };
  // Authenticated read-only preview. No Teams call or dispatch claim.
  if (requestBody?.preview_date !== undefined) {
    const date=requestBody.preview_date;
    if (typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return Response.json({status:"INVALID_PREVIEW_DATE"},{status:400});
    const midnight=Date.parse(date+"T00:00:00.000Z");
    if (!Number.isFinite(midnight) ||
        new Date(midnight).toISOString().slice(0,10)!==date)
      return Response.json({status:"INVALID_PREVIEW_DATE"},{status:400});
    try {
      const start=new Date(midnight-7*3600000).toISOString();
      const end=new Date(midnight+17*3600000).toISOString();
      const [receiving,quality]=await Promise.all([
        loadIssues(start,end),loadQualityIssues(start,end),
      ]);
      return Response.json({status:"PREVIEW_ONLY",date,
        receiving_count:receiving.length,quality_count:quality.length,
        card:card(date,receiving,quality)});
    } catch (_) {
      return Response.json({status:"PREVIEW_FAILED",date},{status:500});
    }
  }
  if (requestBody?.test_send_once === true) {
    const yesterday=bangkokYesterday();
    const testDate=new Date(Date.parse(yesterday.date+"T00:00:00Z")+86400000)
      .toISOString().slice(0,10);
    const testDestination="teams-personal-chat-TEST";
    const query="receiving_report_dispatches?report_date=eq."+testDate+
      "&destination=eq."+testDestination;
    try {
      const claimed=await db("receiving_report_dispatches?on_conflict=report_date,destination",
        "POST",{report_date:testDate,destination:testDestination,status:"SENDING"},
        "resolution=ignore-duplicates,return=representation");
      if (!Array.isArray(claimed) || claimed.length===0)
        return Response.json({status:"TEST_ALREADY_ATTEMPTED",date:testDate});
      const sentAt=new Date().toLocaleString("th-TH",{
        timeZone:"Asia/Bangkok",hour12:false});
      const testCard={
        type:"message",
        attachments:[{
          contentType:"application/vnd.microsoft.card.adaptive",
          contentUrl:null,
          content:{
            "$schema":"http://adaptivecards.io/schemas/adaptive-card.json",
            type:"AdaptiveCard",version:"1.2",body:[
              {type:"TextBlock",text:"WHservice | ทดสอบการเชื่อมต่อ Teams",weight:"Bolder",
                size:"Medium",wrap:true},
              {type:"TextBlock",text:"ข้อความทดสอบ 1 ครั้ง • "+sentAt+" (เวลาไทย)",wrap:true},
              {type:"TextBlock",text:"ทดสอบเส้นทาง Supabase → Teams ส่วนตัวสำเร็จเมื่อได้รับข้อความนี้",
                wrap:true},
              {type:"TextBlock",text:"ไม่ใช่รายงานสินค้าจริง และไม่มีการสร้างรายการปัญหา",
                wrap:true,isSubtle:true},
            ],
          },
        }],
      };
      const response=await fetch(env("TEAMS_WEBHOOK_URL"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(testCard),
      });
      if (!response.ok) throw new Error("TEAMS_TEST_HTTP_"+response.status);
      await db(query,"PATCH",{
        status:"SENT",updated_at:new Date().toISOString(),error_code:null,
      });
      return Response.json({status:"TEST_ACCEPTED_BY_TEAMS_WORKFLOW",
        date:testDate,webhook_http_status:response.status});
    } catch (error) {
      const code=error instanceof Error?error.message.slice(0,70):"UNKNOWN";
      await db(query,"PATCH",{
        status:"FAILED",updated_at:new Date().toISOString(),error_code:code,
      }).catch(()=>{});
      return Response.json({status:"TEST_FAILED",date:testDate,error_code:code},{status:502});
    }
  }

  // One authorized live-data send. Separate from the scheduled and connectivity-test dispatches.
  if (requestBody?.test_real_date === "2026-10-21") {
    const date="2026-10-21", destination="TEST-REAL-20261021";
    const start="2026-10-20T17:00:00.000Z", end="2026-10-21T17:00:00.000Z";
    const dispatchPath="receiving_report_dispatches?report_date=eq."+date+
      "&destination=eq."+destination;
    try {
      const prior=await db(dispatchPath+"&select=status") as Array<{status:string}>;
      if (prior.length) return Response.json({status:"REAL_ALREADY_ATTEMPTED",
        date,previousStatus:prior[0].status});
      const receiving=await loadIssues(start,end);
      const params=new URLSearchParams({
        select:"branch,product,supplier,lot,quantity_text,weight_text,defect,resolution,status,message_at",
        message_at:"gte."+start, and:"(message_at.lt."+end+",is_void.eq.false)",
        order:"message_at.asc",limit:"100",
      });
      const quality=await db("line_quality_issues?"+params.toString()) as Array<{
        branch:string|null;product:string|null;quantity_text:string|null;
        weight_text:string|null;defect:string|null;resolution:string|null;
      }>;
      if (!quality.length) return Response.json({status:"NO_REAL_QUALITY_DATA",date,
        receiving_count:receiving.length,quality_count:0},{status:409});
      if (quality.length>=100) return Response.json({status:"REAL_REPORT_TOO_LARGE",date},
        {status:409});
      const claimed=await db("receiving_report_dispatches?on_conflict=report_date,destination",
        "POST",{report_date:date,destination,status:"SENDING"},
        "resolution=ignore-duplicates,return=representation");
      if (!Array.isArray(claimed)||!claimed.length)
        return Response.json({status:"REAL_ALREADY_ATTEMPTED",date});
      const branchCount=new Set(quality.map(q=>q.branch).filter(Boolean)).size;
      const body:any[]=[
        {type:"TextBlock",text:"WHservice | สรุปปัญหาคุณภาพสินค้าจริง 21 ต.ค. 2569",
          weight:"Bolder",size:"Medium",wrap:true},
        {type:"TextBlock",text:"ข้อมูลจาก LINE ตามเวลารับข้อความ 00:00–23:59 น. (เวลาไทย)",
          isSubtle:true,wrap:true},
        {type:"TextBlock",text:"คุณภาพสินค้า "+quality.length+" รายการ จาก "+branchCount+
          " สาขา | รับสินค้าไม่ตรงจำนวน "+receiving.length+" รายการ",
          weight:"Bolder",wrap:true},
      ];
      for (const [i,q] of quality.entries()) {
        const detail=[q.branch||"ไม่ระบุสาขา",q.product||"ไม่ระบุสินค้า",
          q.quantity_text||"",q.weight_text||""].filter(Boolean).join(" | ");
        const defect=(q.defect||"ไม่ระบุอาการ").slice(0,500);
        const resolution=q.resolution ? "การดำเนินการที่แจ้ง: "+q.resolution.slice(0,500)
          : "การดำเนินการที่แจ้ง: ไม่ระบุ";
        body.push({type:"TextBlock",text:(i+1)+". "+detail+"\nปัญหา: "+defect+
          "\n"+resolution,wrap:true,separator:true});
      }
      body.push({type:"TextBlock",text:"ทดสอบส่งข้อมูลจริงครั้งเดียว | ปลายทาง "+destination+
        " | สถานะรายการในระบบ: รอตรวจสอบ",isSubtle:true,wrap:true});
      const payload={type:"message",attachments:[{
        contentType:"application/vnd.microsoft.card.adaptive",contentUrl:null,
        content:{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json",
          type:"AdaptiveCard",version:"1.2",body},
      }]};
      try {
        const response=await fetch(env("TEAMS_WEBHOOK_URL"),{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("TEAMS_REAL_HTTP_"+response.status);
        await db(dispatchPath,"PATCH",{status:"SENT",
          updated_at:new Date().toISOString(),error_code:null});
        return Response.json({status:"REAL_ACCEPTED_BY_TEAMS_WORKFLOW",date,
          destination,receiving_count:receiving.length,quality_count:quality.length,
          branch_count:branchCount,webhook_http_status:response.status});
      } catch (error) {
        const code=error instanceof Error?error.message.slice(0,70):"UNKNOWN";
        await db(dispatchPath,"PATCH",{status:"FAILED",
          updated_at:new Date().toISOString(),error_code:code}).catch(()=>{});
        return Response.json({status:"REAL_SEND_FAILED",date,error_code:code},{status:502});
      }
    } catch (_) {
      console.error("One-time real report failed before dispatch.");
      return Response.json({status:"REAL_REPORT_PREP_FAILED",date},{status:500});
    }
  }

  // One authorized combined-data test for 22 Oct. Its dispatch key cannot
  // collide with either the scheduled report or the earlier real-data test.
  if (requestBody?.test_combined_date === "2026-10-22") {
    const date="2026-10-22", destination="TEST-COMBINED-20261022";
    const start="2026-10-21T17:00:00.000Z", end="2026-10-22T17:00:00.000Z";
    const dispatchPath="receiving_report_dispatches?report_date=eq."+date+
      "&destination=eq."+destination;
    try {
      const [receiving,quality]=await Promise.all([
        loadIssues(start,end),loadQualityIssues(start,end),
      ]);
      if (!quality.length) return Response.json({status:"NO_REAL_QUALITY_DATA",
        date},{status:409});
      const claimed=await db("receiving_report_dispatches?on_conflict=report_date,destination",
        "POST",{report_date:date,destination,status:"SENDING"},
        "resolution=ignore-duplicates,return=representation");
      if (!Array.isArray(claimed)||!claimed.length)
        return Response.json({status:"COMBINED_ALREADY_ATTEMPTED",date});
      try {
        const payload=card(date,receiving,quality);
        payload.attachments[0].content.body.unshift({type:"TextBlock",
          text:"ทดสอบข้อมูลจริงครั้งเดียว | แยกจากรายงานประจำวัน",
          weight:"Bolder",wrap:true});
        const response=await fetch(env("TEAMS_WEBHOOK_URL"),{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("TEAMS_COMBINED_HTTP_"+response.status);
        await db(dispatchPath,"PATCH",{status:"SENT",
          updated_at:new Date().toISOString(),error_code:null});
        return Response.json({status:"COMBINED_ACCEPTED_BY_TEAMS_WORKFLOW",date,
          destination,receiving_count:receiving.length,quality_count:quality.length,
          quality_branches:new Set(quality.map(q=>q.branch).filter(Boolean)).size,
          webhook_http_status:response.status});
      } catch (error) {
        const code=error instanceof Error?error.message.slice(0,70):"UNKNOWN";
        await db(dispatchPath,"PATCH",{status:"FAILED",
          updated_at:new Date().toISOString(),error_code:code}).catch(()=>{});
        return Response.json({status:"COMBINED_SEND_FAILED",date,error_code:code},
          {status:502});
      }
    } catch (_) {
      console.error("Combined test failed before dispatch.");
      return Response.json({status:"COMBINED_PREP_FAILED",date},{status:500});
    }
  }

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
      const [issues,quality]=await Promise.all([
        loadIssues(day.start,day.end),loadQualityIssues(day.start,day.end),
      ]);
      // Webhook must be created from a Microsoft Teams Workflows CHAT template, scoped to the requested 1:1 recipient.
      const response=await fetch(env("TEAMS_WEBHOOK_URL"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(card(day.date,issues,quality)),
      });
      if (!response.ok) throw new Error("TEAMS_HTTP_"+response.status);
      await db("receiving_report_dispatches?report_date=eq."+day.date+"&destination=eq."+destination,
        "PATCH",{status:"SENT",updated_at:new Date().toISOString(),error_code:null});
      return new Response(JSON.stringify({status:"SENT",date:day.date,
        receiving_count:issues.length,quality_count:quality.length}),{status:200});
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
