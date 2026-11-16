import test from "node:test";
import assert from "node:assert/strict";
import {
  trafficGroup,
  normalizeTrafficQuarter,
  trafficQuarterRequest,
} from "../traffic-quarter.mjs";
import { trafficAreaMarkup } from "../public/business-overview.mjs";
const row = (week, channel, source, sessions) => ({
  dimensionValues: [{ value: week }, { value: channel }, { value: source }],
  metricValues: [{ value: String(sessions) }],
});
test("traffic groups conserve sessions and recognize Viber from the actual source", () => {
  assert.equal(trafficGroup("Organic Search"), "organic");
  assert.equal(trafficGroup("Cross-network"), "paid");
  assert.equal(trafficGroup("Direct"), "direct");
  assert.equal(trafficGroup("Unassigned", "viber"), "email");
  assert.equal(trafficGroup("Referral", "partner.ua"), "other");
  const report = normalizeTrafficQuarter(
    [
      row("202634", "Organic Search", "google", 100),
      row("202634", "Cross-network", "google", 30),
      row("202634", "Direct", "(direct)", 20),
      row("202634", "Unassigned", "viber", 10),
      row("202634", "Referral", "partner.ua", 5),
    ],
    { from: "2026-08-17", to: "2026-11-15" },
  );
  assert.equal(report.weeks.length, 13);
  assert.deepEqual(report.weeks[0].counts, {
    organic: 100,
    paid: 30,
    direct: 20,
    email: 10,
    other: 5,
  });
  assert.equal(report.total, 165);
  const html = trafficAreaMarkup(report);
  assert.match(html, /<svg/);
  assert.match(html, /data-tip-target="#traffic-quarter-tooltip"/);
  assert.match(html, /Т34/);
  assert.match(html, /Т46/);
  assert.match(html, /Email і Viber/);
});
test("GA4 request is weekly, paginated, and public projection drops source identifiers", () => {
  const range = { from: "2026-08-17", to: "2026-11-15" },
    request = trafficQuarterRequest(range, 10000);
  assert.equal(request.dimensions[0].name, "isoYearIsoWeek");
  assert.equal(request.offset, "10000");
  const report = normalizeTrafficQuarter(
    [row("202634", "Referral", "private-source", 42)],
    range,
  );
  assert.doesNotMatch(JSON.stringify(report), /private-source/);
  assert.equal(report.weeks[0].total, 42);
});
