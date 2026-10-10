/** Give a useful error when a proxy returns HTML instead of JSON (including Safari). */
export async function readApiJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Сервер повернув некоректну відповідь (HTTP ${response.status}). Повторіть оновлення.`);
  }
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? data.error : null;
    throw new Error(typeof error === "string" ? error : `Не вдалося завантажити дані (HTTP ${response.status}).`);
  }
  return data as T;
}

/** One retry for a temporary gateway outage; never retry aborted navigation. */
export async function fetchApiJson<T = unknown>(url: string, init: RequestInit = {}) {
  let response = await fetch(url, init);
  if ([502, 503, 504].includes(response.status) && !init.signal?.aborted) {
    await response.body?.cancel();
    response = await fetch(url, init);
  }
  return readApiJson<T>(response);
}
