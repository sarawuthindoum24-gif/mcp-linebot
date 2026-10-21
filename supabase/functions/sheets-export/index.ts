const encoder = new TextEncoder();

function equalConstantTime(a: string, b: string): boolean {
  const left = encoder.encode(a), right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret ${name}`);
  return value;
}

async function readRows(path: string): Promise<unknown[]> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  if (!response.ok) throw new Error("DB_" + response.status);
  return await response.json();
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("SHEETS_SYNC_SECRET");
  if (!secret) return new Response("Sync secret not configured", { status: 503 });
  if (!equalConstantTime(request.headers.get("x-sheets-sync-secret") || "", secret))
    return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const offset = Number(url.searchParams.get("offset") || "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    return new Response("Invalid offset", { status: 400 });
  const limit = 500;
  let path: string;
  if (kind === "issues") {
    path = "receiving_issues?" + new URLSearchParams({
      select: "id,line_message_id,line_item_index,branch,product,issue_date,message_at,ordered_qty,received_qty,delta_qty,unit,variance_type,status,group_id",
      is_void: "eq.false", order: "message_at.asc,id.asc", limit: String(limit), offset: String(offset),
    });
  } else if (kind === "dispatches") {
    path = "receiving_report_dispatches?" + new URLSearchParams({
      select: "report_date,destination,status,created_at,updated_at,error_code",
      order: "report_date.asc,destination.asc", limit: String(limit), offset: String(offset),
    });
  } else if (kind === "groups") {
    path = "line_group_registry?" + new URLSearchParams({
      select: "group_id,group_name,route,route_source,last_seen_at,created_at",
      order: "group_id.asc", limit: String(limit), offset: String(offset),
    });
  } else if (kind === "quality") {
    path = "line_quality_issues?" + new URLSearchParams({
      select: "line_message_id,group_id,message_at,branch,product,supplier,lot,quantity_text,weight_text,defect,resolution,status,raw_text",
      is_void: "eq.false", order: "message_at.asc,line_message_id.asc",
      limit: String(limit), offset: String(offset),
    });
  } else if (kind === "media") {
    path = "line_group_messages?" + new URLSearchParams({
      select: "line_message_id,group_id,message_type,message_at,route",
      message_type: "in.(image,video,file)",
      is_void: "eq.false", order: "message_at.asc,line_message_id.asc",
      limit: String(limit), offset: String(offset),
    });
  } else {
    return new Response("Invalid kind", { status: 400 });
  }
  try {
    const items = await readRows(path);
    if (!Array.isArray(items)) throw new Error("INVALID_DB_RESPONSE");
    return Response.json({ items, nextOffset: items.length === limit ? offset + items.length : null }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (_) {
    console.error("Sheets export failed");
    return new Response("Export failed", { status: 500 });
  }
});

