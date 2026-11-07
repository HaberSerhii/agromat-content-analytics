export interface GroutInputs {
  length: number;
  width: number;
  thickness: number;
  depth: number;
  joint: number;
  area: number;
  density: number;
  waste: number;
}

export interface GroutProduct {
  id: number;
  code: number;
  name: string;
  brand: string;
  url: string;
  price: number | null;
  currency: string;
  stock: number | null;
  status: string;
  packKg: number | null;
  attributes: { name: string; values: string[] }[];
  updatedAt: string;
}

export const defaultGroutInputs: GroutInputs = {
  length: 600, width: 300, thickness: 10, depth: 8,
  joint: 3, area: 25, density: 1.8, waste: 10,
};

export function calculateGrout(input: GroutInputs, packKg?: number | null, price?: number | null) {
  const positive = [input.length, input.width, input.thickness, input.depth, input.joint, input.area, input.density];
  if (positive.some(n => typeof n !== "number" || !Number.isFinite(n) || n <= 0))
    throw new Error("Розміри, площа й щільність мають бути додатними числами.");
  if (!Number.isFinite(input.waste) || input.waste < 0 || input.waste > 100)
    throw new Error("Запас має бути від 0 до 100%.");
  if (input.depth > input.thickness) throw new Error("Глибина шва не може перевищувати товщину плитки.");
  if (input.joint >= Math.min(input.length, input.width)) throw new Error("Ширина шва має бути меншою за розміри плитки.");
  const perM2 = ((input.length + input.width) / (input.length * input.width)) * input.depth * input.joint * input.density;
  const baseKg = perM2 * input.area;
  const totalKg = baseKg * (1 + input.waste / 100);
  if (!Number.isFinite(totalKg)) throw new Error("Значення завеликі для розрахунку.");
  const packs = packKg && Number.isFinite(packKg) && packKg > 0 ? Math.ceil(totalKg / packKg) : null;
  const purchasedKg = packs !== null && packKg ? packs * packKg : null;
  const cost = packs !== null && price != null && Number.isFinite(price) && price >= 0 ? packs * price : null;
  return { perM2, baseKg, totalKg, packs, purchasedKg, cost };
}

export function parsePackKg(attributes: GroutProduct["attributes"], name: string): number | null {
  const packaging = attributes.filter(a => /пакування|фасування|упаков|маса нетто/i.test(a.name)).flatMap(a => a.values).join(" ");
  const match = (packaging || name).match(/(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g)(?=\s|$|[),])/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", ".")) / (/^(г|g)$/i.test(match[2]) ? 1000 : 1);
  return value > 0 ? value : null;
}

export function jointRange(product: GroutProduct): [number, number] | null {
  const text = product.attributes.filter(a => /ширина шва/i.test(a.name)).flatMap(a => a.values).join(" ");
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/);
  return match ? [Number(match[1].replace(",", ".")), Number(match[2].replace(",", "."))] : null;
}

export function normalizeGroutQuery(text: string): string {
  return text.toLocaleLowerCase().replace(/ё/g, "е")
    .replace(/басс?ейн[а-яіїє]*/g, "басейн").replace(/бел(ая|ый|ое)/g, "білий")
    .replace(/ванная|ванной/g, "ванна").replace(/сер(ая|ый|ое)/g, "сірий")
    .replace(/біл[а-яіїє]*/g, "біл").replace(/сір[а-яіїє]*/g, "сір")
    .replace(/эпоксид/g, "епоксид").replace(/цементн/g, "цемент")
    .replace(/затирк[аиуою]*|затірк[аиуою]*|фуг[аиуою]*/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function rankGroutProducts(products: GroutProduct[], query: string): GroutProduct[] {
  const stopwords = new Set(["для", "які", "про", "мені", "покажи", "підбери", "товар", "обраний", "обрану", "порівняй", "есть", "мне", "расскажи", "відомо"]);
  const tokens = normalizeGroutQuery(query).split(/\s+/).filter(t => t.length > 2 && !stopwords.has(t));
  if (!tokens.length) return [...products];
  return products.map(product => {
    const text = normalizeGroutQuery([product.name, product.brand, String(product.code), ...product.attributes.flatMap(a => a.values)].join(" "));
    return { product, score: tokens.filter(t => text.includes(t)).length };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).map(p => p.product);
}

export function safeProductUrl(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && /(^|\.)agromat\.ua$/.test(parsed.hostname) ? parsed.href : null; }
  catch { return null; }
}
