/** Give a useful error when a proxy returns HTML instead of JSON (including Safari). */
export async function readApiJson(response: Response): Promise<any> {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Сервер повернув некоректну відповідь (HTTP ${response.status}). Повторіть оновлення.`);
  }
  if (!response.ok) throw new Error(data?.error || `Не вдалося завантажити дані (HTTP ${response.status}).`);
  return data;
}

/** One retry for a temporary gateway outage; never retry aborted navigation. */
export async function fetchApiJson(url: string, init: RequestInit = {}) {
  let response = await fetch(url, init);
  if ([502, 503, 504].includes(response.status) && !init.signal?.aborted) {
    await response.body?.cancel();
    response = await fetch(url, init);
  }
  return readApiJson(response);
}
