import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import IORedis from "ioredis";

const SNAP_DIR = process.env.PRODUCT_SNAPSHOTS_DIR || "/var/lib/agromat-analytics/product-snapshots";
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const GROUPS = ["photos", "attributes", "reviews", "sku", "prices"];
const DATES = process.argv.slice(2);

function readSnap(date) {
  const file = path.join(SNAP_DIR, `${date}.json.gz`);
  const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
  if (!Array.isArray(snap.products)) throw new Error(`Bad snapshot: ${date}`);
  return snap;
}

function base(next, at) {
  return {
    at,
    productId: next.id,
    productName: next.name,
    productUrl: next.url,
    categoryId: next.categoryId,
    categoryName: next.categoryName,
    statusId: next.statusId,
    statusName: next.statusName,
    firstSeenAt: next.firstSeenAt,
  };
}

function indexById(products) {
  const out = new Map();
  for (const p of products) out.set(p.id, p);
  return out;
}

function diff(prevSnap, nextSnap) {
  const prev = indexById(prevSnap.products);
  const at = nextSnap.syncedAt || `${nextSnap.date}T03:00:00.000Z`;
  const events = [];

  for (const next of nextSnap.products) {
    const old = prev.get(next.id);
    if (!old) continue;
    const b = base(next, at);

    if ((old.imagesCount ?? 0) !== (next.imagesCount ?? 0)) {
      events.push({
        ...b,
        group: "photos",
        fromCount: old.imagesCount ?? 0,
        toCount: next.imagesCount ?? 0,
        addedUrls: [],
        removedUrls: [],
      });
    }

    if ((old.attributesCount ?? 0) !== (next.attributesCount ?? 0)) {
      const delta = (next.attributesCount ?? 0) - (old.attributesCount ?? 0);
      events.push({
        ...b,
        group: "attributes",
        fromCount: old.attributesCount ?? 0,
        toCount: next.attributesCount ?? 0,
        attrAdded: Math.max(delta, 0),
        attrRemoved: Math.max(-delta, 0),
        attrChanged: 0,
      });
    }

    if ((old.reviewsCount ?? 0) !== (next.reviewsCount ?? 0) || (old.ratingAvg ?? null) !== (next.ratingAvg ?? null)) {
      events.push({
        ...b,
        group: "reviews",
        fromCount: old.reviewsCount ?? 0,
        toCount: next.reviewsCount ?? 0,
        fromRating: old.ratingAvg ?? null,
        toRating: next.ratingAvg ?? null,
      });
    }

    if ((old.sku ?? null) !== (next.sku ?? null)) {
      events.push({ ...b, group: "sku", fromSku: old.sku ?? null, toSku: next.sku ?? null });
    }

    if ((old.price ?? null) !== (next.price ?? null)) {
      events.push({
        ...b,
        group: "prices",
        fromPrice: old.price ?? null,
        toPrice: next.price ?? null,
        currency: next.currency || old.currency || "UAH",
      });
    }
  }

  return events;
}

if (DATES.length < 2) {
  console.error("Usage: node scripts/backfill-timeline-from-snapshots.mjs YYYY-MM-DD YYYY-MM-DD ...");
  process.exit(2);
}

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 3 });
const snaps = Object.fromEntries(DATES.map((date) => [date, readSnap(date)]));

// Idempotency: remove prior generated events for these exact snapshot sync times.
for (const group of GROUPS) {
  for (const date of DATES.slice(1)) {
    const score = Date.parse(snaps[date].syncedAt || `${date}T03:00:00.000Z`);
    await redis.zremrangebyscore(`products:timeline:${group}`, score, score);
  }
}

const totals = Object.fromEntries(GROUPS.map((group) => [group, 0]));
for (let i = 1; i < DATES.length; i++) {
  const prevDate = DATES[i - 1];
  const nextDate = DATES[i];
  const events = diff(snaps[prevDate], snaps[nextDate]);
  const byGroup = new Map();

  for (const event of events) {
    const arr = byGroup.get(event.group) ?? [];
    arr.push(event);
    byGroup.set(event.group, arr);
  }

  for (const [group, arr] of byGroup) {
    const args = [];
    for (const event of arr) args.push(String(Date.parse(event.at)), JSON.stringify(event));
    if (args.length) await redis.zadd(`products:timeline:${group}`, ...args);
    totals[group] += arr.length;
  }

  console.log(`${prevDate}->${nextDate}`, Object.fromEntries([...byGroup.entries()].map(([group, arr]) => [group, arr.length])));
}

console.log("totals", totals);
await redis.quit();
