import test from "node:test";
import assert from "node:assert/strict";
process.env.STUDIO_TEST = "1";
const { server } = await import("../server.mjs");
test("public server exposes only static assets, health and read-only bounded APIs", async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    let r = await fetch(base + "/api/health");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).service, "agromat-studio");
    r=await fetch(base+"/api/capabilities");
    assert.equal((await r.json()).privateOverview,false);
    r=await fetch(base+"/api/revenue-waterfall?from=2026-11-01&to=2026-11-15");
    assert.equal(r.status,404,"private analysis is disabled by default");
    r = await fetch(base + "/site-funnel.mjs");
    assert.equal(r.status,200);
    assert.match(await r.text(),/renderSiteFunnel/);
    r = await fetch(base + "/api/site-funnel?mode=custom");
    assert.equal(r.status,400);
    r = await fetch(base + "/api/admin/deploy", { method: "POST" });
    assert.equal(r.status, 405);
    r = await fetch(base + "/api/admin/deploy");
    assert.equal(r.status, 404);
    r = await fetch(base + "/api/products?from=2026-02-30&to=2026-03-01");
    assert.equal(r.status, 400);
    r = await fetch(base + "/api-cache.mjs");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /javascript/);
    assert.match(await r.text(), /createApiCache/);
    for (const asset of ["business-overview.mjs", "business-overview.css", "revenue-drivers.mjs", "overview-filters.mjs", "inventory-demand.mjs", "content-conversion.mjs", "content-conversion.css", "content-conversion-filters.mjs"]) {
      r = await fetch(base + "/" + asset);
      assert.equal(r.status, 200);
    }
    r = await fetch(base + "/api/inventory-demand?days=365");
    assert.equal(r.status,400,"inventory demand uses the fixed 30-day window");
    r=await fetch(base+'/api/overview?from=2026-11-01&to=2026-11-17&compareMode=wow&salesScope=all&acquisition=all&device=all');
    assert.equal(r.status,400,'invalid comparison is rejected before loading sources');
    r=await fetch(base+'/api/overview?from=2026-11-11&to=2026-11-17&compareMode=wow&salesScope=marketplaces&acquisition=all&device=mobile');
    assert.equal(r.status,400,'website device cannot be presented as marketplace traffic');
    r = await fetch(base + '/api/content-conversion?device=unsupported');
    assert.equal(r.status,400,'invalid report filters are rejected before using data sources');
    r = await fetch(base + '/api/content-conversion', {method:'POST'});
    assert.equal(r.status,405);
    r = await fetch(base + '/content-conversion-source.mjs');
    assert.equal(r.status,404,'private report sources are never browser assets');
    r=await fetch(base+'/overview-source-worker.mjs');
    assert.equal(r.status,404,'source worker is never a browser asset');
    r = await fetch(base + "/.env");
    assert.equal(r.status, 404);
    r = await fetch(base + "/");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(await r.text(), /AGРОМАТ|АГРОМАТ/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
