import { parseReceivingMessage } from "../_shared/parser.ts";

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

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", {status:405});
  try {
    const raw = await request.text();
    if (encoder.encode(raw).length > 256000) return new Response("Payload too large", {status:413});
    const valid = await verified(raw, request.headers.get("x-line-signature") || "", env("LINE_CHANNEL_SECRET"));
    if (!valid) return new Response("Invalid signature", {status:401});
    const payload = JSON.parse(raw) as {events?: LineEvent[]};
    for (const event of payload.events || []) {
      if (!["group", "room"].includes(event.source?.type || "")) continue;
      if (event.type === "unsend" && event.unsend?.messageId) {
        const messageId = encodeURIComponent(event.unsend.messageId);
        await db("receiving_issues?line_message_id=eq." + messageId, "PATCH", {
          is_void: true, voided_at: new Date().toISOString(),
        });
        continue;
      }
      if (event.type !== "message" || event.message?.type !== "text") continue;
      if (!event.message.id || typeof event.message.text !== "string") continue;
      const parsed = parseReceivingMessage(event.message.text, event.timestamp || Date.now());
      if (parsed.unparsed_lines > 0) {
        await db("receiving_parse_review?on_conflict=line_message_id", "POST", {
          line_message_id: event.message.id,
          message_at: new Date(event.timestamp || Date.now()).toISOString(),
          reason: "UNPARSED_ITEM_LINES_" + parsed.unparsed_lines,
        }, "resolution=merge-duplicates");
      }
      if (!parsed.items.length) continue;
      const rows = parsed.items.map(x => ({
        line_message_id: event.message!.id!,
        line_item_index: x.index,
        branch: x.branch, product: x.product, issue_date: x.issue_date,
        message_at: new Date(event.timestamp || Date.now()).toISOString(),
        ordered_qty: x.ordered_qty, received_qty: x.received_qty,
        delta_qty: x.delta_qty, unit: x.unit, variance_type: x.variance_type,
      }));
      await db("receiving_issues?on_conflict=line_message_id,line_item_index", "POST", rows,
        "resolution=ignore-duplicates");
    }
    return new Response(JSON.stringify({ok:true}), {status:200, headers:{"Content-Type":"application/json"}});
  } catch (e) {
    console.error("Receiving webhook failed", e instanceof SyntaxError ? "INVALID_JSON" : "PROCESSING_FAILED");
    return new Response("Temporary processing failure", {status:500});
  }
});
