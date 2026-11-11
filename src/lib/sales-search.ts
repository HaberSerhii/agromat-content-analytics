/** Match every search word against a single position, never unrelated order lines. */
export function matchesSalesSearch(item: { code: string | number; name?: string | null; brand?: string | null; category?: string | null }, query = "") {
  const words = query.trim().toLocaleLowerCase("uk-UA").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [item.code, item.name, item.brand, item.category].filter(value => value != null).join(" ").toLocaleLowerCase("uk-UA");
  return words.every(word => text.includes(word));
}
