import { parseReceivingMessage } from "../_shared/parser.ts";
import { routeFromName,routeFromText,parseQualityMessage,type GroupRoute } from "../_shared/group-routing.ts";

type LineEvent = {
  type?: string;
  timestamp?: number;
  source?: {type?: string; groupId?: string; roomId?: string};
  message?: {type?: string; id?: string; text?: string};
  unsend?: {messageId?: string};
};

function env(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error("Missing required secret " + key);
  return v;
}
const encoder = new TextEncoder();

function equalConstantTime(a: string, b: string): boolean {
  const left = encoder.encode(a), right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
async function verified(raw: string, signature: string, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  const hash = btoa(Array.from(bytes, x => String.fromCharCode(x)).join(""));
  return equalConstantTime(hash, signature);
}
async function db(path: string, method: string, body: unknown, prefer?: string): Promise<unknown> {
  const url = env("SUPABASE_URL") + "/rest/v1/" + path;
  const headers: Record<string, string> = {
    apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
    Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, {method, headers, body: body === null ? undefined : JSON.stringify(body)});
  if (!response.ok) throw new Error("DB_" + response.status);
  const data = await response.text();
  return data ? JSON.parse(data) : null;
}


type Registry = {group_id:string;group_name:string|null;route:GroupRoute;route_source:string};
async function resolveGroup(groupId:string, text:string, isGroup:boolean, at:string):Promise<Registry> {
  const records = await db("line_group_registry?select=group_id,group_name,route,route_source&group_id=eq."+
    encodeURIComponent(groupId), "GET", null) as Registry[];
  const existing = records?.[0];
  let name=existing?.group_name||null;
  // LINE webhook supplies groupId, not the group display name.
  // A channel access token (distinct from the channel secret) is optional.
  const token=Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (!name && isGroup && token) {
    try {
      const response=await fetch("https://api.line.me/v2/bot/group/"+
        encodeURIComponent(groupId)+"/summary",{headers:{Authorization:"Bearer "+token}});
      if (response.ok) {
        const info=await response.json() as {groupName?:string};
        if (typeof info.groupName==="string") name=info.groupName.slice(0,200);
      }
    } catch (_) { /* Never block receiving during LINE name lookup outage. */ }
  }
  const inferred=(name?routeFromName(name):"UNMAPPED")||"UNMAPPED";
  const hint=routeFromText(text);
  // The saved group-level route (including MANUAL overrides) wins over a message hint.
  const route:GroupRoute=existing?.route && existing.route!=="UNMAPPED" ?
    existing.route : inferred!=="UNMAPPED" ? inferred : hint;
  const route_source=existing?.route && existing.route!=="UNMAPPED" ?
    existing.route_source : inferred!=="UNMAPPED" ? "LINE_API" :
    hint!=="UNMAPPED" ? "TEXT_HINT" : "UNKNOWN";
  if (!existing) {
    await db("line_group_registry?on_conflict=group_id","POST",{
      group_id:groupId,group_name:name,route,route_source,last_seen_at:at
    },"resolution=ignore-duplicates");
  } else {
    // Never silently overwrite manually classified groups.
    const change:Record<string,unknown>={last_seen_at:at};
    if (name && !existing.group_name) change.group_name=name;
    if (existing.route==="UNMAPPED" && route!=="UNMAPPED") {
      change.route=route;change.route_source=route_source;
    }
    await db("line_group_registry?group_id=eq."+encodeURIComponent(groupId),
      "PATCH",change);
  }
  return {group_id:groupId,group_name:name,route,route_source};
}
Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", {status:405});
  try {
    const raw=await request.text();
    if (encoder.encode(raw).length>256000) return new Response("Payload too large",{status:413});
    if (!await verified(raw,request.headers.get("x-line-signature")||"",env("LINE_CHANNEL_SECRET")))
      return new Response("Invalid signature",{status:401});
    const payload=JSON.parse(raw) as {events?:LineEvent[]};
    for (const event of payload.events||[]) {
      if (!["group","room"].includes(event.source?.type||"")) continue;
      const groupId=event.source?.type==="group" ? event.source.groupId :
        event.source?.roomId ? "room:"+event.source.roomId : undefined;
      if (!groupId) continue;
      const at=new Date(event.timestamp||Date.now()).toISOString();
      if (event.type==="unsend" && event.unsend?.messageId) {
        const id=encodeURIComponent(event.unsend.messageId);
        const voiding={is_void:true,voided_at:new Date().toISOString()};
        // All downstream sources use is_void=false.
        await db("line_group_messages?line_message_id=eq."+id,"PATCH",voiding);
        await db("line_quality_issues?line_message_id=eq."+id,"PATCH",voiding);
        await db("receiving_issues?line_message_id=eq."+id,"PATCH",voiding);
        await db("receiving_parse_review?line_message_id=eq."+id,"DELETE",null);
        continue;
      }
      if (!["message","join"].includes(event.type||"")) continue;
      const item=event.message;
      const text=item?.type==="text" && typeof item.text==="string"?item.text:"";
      const group=await resolveGroup(groupId,text,event.source?.type==="group",at);
      if (event.type==="join" || !item?.id) continue;
      // Preserve source for both text and images, even before a group is classified.
      await db("line_group_messages?on_conflict=line_message_id","POST",{
        line_message_id:item.id,group_id:groupId,message_type:item.type||"unknown",
        route:group.route,message_at:at,raw_text:text?text.slice(0,8000):null
      },"resolution=ignore-duplicates");
      if (group.route==="QUALITY") {
        if (item.type==="text" && text.trim()) {
          await db("line_quality_issues?on_conflict=line_message_id","POST",{
            line_message_id:item.id,group_id:groupId,message_at:at,
            ...parseQualityMessage(text),raw_text:text.slice(0,8000)
          },"resolution=ignore-duplicates");
        }
        continue;
      }
      // Unmapped messages remain in secured intake until the group is identified.
      if (group.route!=="RECEIVING" || item.type!=="text" || !text) continue;
      const parsed=parseReceivingMessage(text,event.timestamp||Date.now());
      if (parsed.unparsed_lines>0) {
        await db("receiving_parse_review?on_conflict=line_message_id","POST",{
          line_message_id:item.id,group_id:groupId,message_at:at,
          reason:"UNPARSED_ITEM_LINES_"+parsed.unparsed_lines
        },"resolution=ignore-duplicates");
      }
      if (!parsed.items.length) continue;
      await db("receiving_issues?on_conflict=line_message_id,line_item_index","POST",
        parsed.items.map(x=>({
          line_message_id:item.id,line_item_index:x.index,group_id:groupId,
          branch:x.branch,product:x.product,issue_date:x.issue_date,message_at:at,
          ordered_qty:x.ordered_qty,received_qty:x.received_qty,delta_qty:x.delta_qty,
          unit:x.unit,variance_type:x.variance_type
        })),"resolution=ignore-duplicates");
    }
    return Response.json({ok:true});
  } catch (error) {
    console.error("Receiving webhook failed",error instanceof SyntaxError?"INVALID_JSON":"PROCESSING_FAILED");
    return new Response("Temporary processing failure",{status:500});
  }
});
