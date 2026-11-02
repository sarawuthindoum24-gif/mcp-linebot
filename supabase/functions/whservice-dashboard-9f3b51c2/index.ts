const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const QUALITY_GROUP = "C5bc53ddf83debcc8471bfeef0b7caf29";
const PAGE_SIZE = 500;
const MAX_ROWS = 5000;

type DbRow = Record<string, unknown>;

function bangkokDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function startOfWindow(): string {
  const today = bangkokDate(new Date());
  const midnightUtc = new Date(`${today}T00:00:00+07:00`);
  midnightUtc.setUTCDate(midnightUtc.getUTCDate() - 29);
  return midnightUtc.toISOString();
}

function clean(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const result = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
  return result || null;
}

function causeFromRaw(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(?:^|\n)\s*(?:\d+[.)]?\s*)?สาเหตุ\s*[:：-]\s*([^\n]+)/i);
  return match ? clean(match[1], 180) : null;
}

async function readRows(table: string, params: Record<string, string>): Promise<{ rows: DbRow[]; truncated: boolean }> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("CONFIGURATION_MISSING");
  const rows: DbRow[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`DATABASE_${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("INVALID_DATABASE_RESPONSE");
    if (offset === MAX_ROWS) return { rows, truncated: page.length > 0 };
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  try {
    const since = startOfWindow();
    const [receiving, quality, registry] = await Promise.all([
      readRows("receiving_issues", {
        select: "message_at,branch,product,ordered_qty,received_qty,delta_qty,unit,variance_type,status",
        is_void: "eq.false", message_at: `gte.${since}`, order: "message_at.desc",
      }),
      readRows("line_quality_issues", {
        select: "message_at,branch,product,quantity_text,weight_text,defect,resolution,status,raw_text",
        is_void: "eq.false", group_id: `eq.${QUALITY_GROUP}`, message_at: `gte.${since}`, order: "message_at.desc",
      }),
      readRows("line_group_registry", {
        select: "route,last_seen_at", route: "eq.RECEIVING", limit: "1",
      }),
    ]);

    const items = [
      ...receiving.rows.map((row) => ({
        type: "RECEIVING", at: row.message_at, branch: clean(row.branch), product: clean(row.product),
        variance: row.variance_type === "OVER" ? "OVER" : "SHORT",
        ordered: row.ordered_qty, received: row.received_qty, difference: row.delta_qty,
        unit: clean(row.unit, 40), issue: null, cause: null, resolution: null,
        status: clean(row.status, 60), quantity: null, weight: null,
      })),
      ...quality.rows.map((row) => ({
        type: "QUALITY", at: row.message_at, branch: clean(row.branch), product: clean(row.product),
        variance: null, ordered: null, received: null, difference: null, unit: null,
        issue: clean(row.defect, 220), cause: causeFromRaw(row.raw_text),
        resolution: clean(row.resolution, 220), status: clean(row.status, 60),
        quantity: clean(row.quantity_text, 80), weight: clean(row.weight_text, 80),
      })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

    return Response.json({
      generatedAt: new Date().toISOString(), timezone: "Asia/Bangkok", windowStart: since,
      receivingConfirmed: registry.rows.length > 0,
      truncated: receiving.truncated || quality.truncated,
      items,
    }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Type": "application/json; charset=utf-8" } });
  } catch (error) {
    console.error("Dashboard read failed", error instanceof Error ? error.message : "UNKNOWN");
    return Response.json({ error: "ไม่สามารถอ่านข้อมูลล่าสุดได้" }, {
      status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
});
