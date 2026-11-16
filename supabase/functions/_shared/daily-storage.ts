import { dailyCsvName } from "./daily-export.ts";

const BUCKET = "whservice-daily-reports";
const LINK_SECONDS = 90 * 86400;

export async function saveDailyFile(
  baseUrl: string, serviceKey: string, reportDate: string, csv: string,
  fetcher: typeof fetch = fetch,
  suffix?: string,
): Promise<string> {
  if (suffix !== undefined && !/^[A-Za-z0-9-]{1,64}$/.test(suffix))
    throw new Error("INVALID_FILE_SUFFIX");
  const name = dailyCsvName(reportDate).replace(/\.csv$/, suffix ? `-${suffix}.csv` : ".csv");
  const objectPath = `${BUCKET}/${name}`;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new Error("INVALID_STORAGE_URL");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const upload = await fetcher(`${url.origin}/storage/v1/object/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "cache-control": "max-age=3600" },
    body: csv,
  });
  if (!upload.ok) throw new Error(`STORAGE_UPLOAD_${upload.status}`);

  const signed = await fetcher(`${url.origin}/storage/v1/object/sign/${objectPath}`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: LINK_SECONDS }),
  });
  if (!signed.ok) throw new Error(`STORAGE_SIGN_${signed.status}`);
  const result = await signed.json() as { signedURL?: unknown };
  if (typeof result.signedURL !== "string" ||
      !result.signedURL.startsWith(`/object/sign/${objectPath}?`)) {
    throw new Error("INVALID_SIGNED_URL");
  }
  const download = new URL(`${url.origin}/storage/v1${result.signedURL}`);
  download.searchParams.set("download", name);
  return download.toString();
}
