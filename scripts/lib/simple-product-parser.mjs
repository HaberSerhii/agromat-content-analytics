function decodeHtml(s) {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s) {
  return decodeHtml(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizePrice(value) {
  if (value == null) return null;
  const text = stripTags(String(value));
  const raw = text.match(/\d[\d\s.,]{0,14}/)?.[0] || "";
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function normalizeStatus(value) {
  const s = String(value || "").toLowerCase();
  if (/outofstock|немає|нет\s+в\s+наличии|відсут|закінчив/.test(s)) return "Немає в наявності";
  if (/preorder|очіку|ожида|під\s*замов|под\s*заказ/.test(s)) return "Під замовлення";
  if (/instock|наяв|налич|купити|купить|в\s+корзин/.test(s)) return "Є в наявності";
  return "unknown";
}

function tagAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || null;
}

export function parseScopedAvailability(html) {
  const schemaTag = html.match(/<(?:meta|link)\b[^>]*\bitemprop=["']availability["'][^>]*>/i)?.[0];
  if (schemaTag) {
    const status = normalizeStatus(tagAttribute(schemaTag, "content") || tagAttribute(schemaTag, "href"));
    if (status !== "unknown") return status;
  }

  const productStatus = html.match(/<[^>]+class=["'][^"']*\bisCount\b[^"']*["'][^>]*>([\s\S]{0,120}?)<\/[^>]+>/i);
  return normalizeStatus(productStatus?.[1]);
}

function collectJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = decodeHtml(m[1]).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // ignore malformed analytics/LD chunks
    }
  }
  return out;
}

function flattenLd(item) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    out.push(node);
    if (Array.isArray(node["@graph"])) visit(node["@graph"]);
    if (Array.isArray(node.offers)) visit(node.offers);
  };
  visit(item);
  return out;
}

function parseFromJsonLd(html) {
  for (const item of collectJsonLd(html)) {
    for (const node of flattenLd(item)) {
      const offer = node.offers && !Array.isArray(node.offers) ? node.offers : node;
      const price = normalizePrice(offer.price ?? offer.lowPrice ?? offer.highPrice);
      const availability = String(offer.availability || node.availability || "");
      if (!price && !availability) continue;
      const foundBrand = typeof node.brand === "object" ? node.brand?.name : node.brand;
      return {
        price,
        status: normalizeStatus(availability),
        foundBrand: foundBrand || null,
      };
    }
  }
  return null;
}

export function parsePlitka(html) {
  const jsonLd = parseFromJsonLd(html);
  if (jsonLd?.price || jsonLd?.status === "Немає в наявності") return jsonLd;

  const m = html.match(/class=["'][^"']*(?:now-price|one-prod-list-price)[^"']*["'][^>]*>([\s\S]{0,180}?)<\/[^>]+>/i);
  const price = normalizePrice(m?.[1]);
  return price ? { price, status: "unknown", foundBrand: null } : null;
}

export function parseLeoceramika(html) {
  const meta = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const sitePrice = html.match(/id=["']site_price["'][^>]*>([\s\S]{0,80}?)<\/span>/i);
  const jsonLd = parseFromJsonLd(html);
  const price = normalizePrice(meta?.[1]) || normalizePrice(sitePrice?.[1]) || jsonLd?.price || null;
  const scopedStatus = parseScopedAvailability(html);
  const status = scopedStatus !== "unknown" ? scopedStatus : jsonLd?.status || "unknown";
  if (!price && status !== "Немає в наявності") return null;
  return { price, status, foundBrand: jsonLd?.foundBrand || null };
}
