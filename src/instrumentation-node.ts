// Node-only boot warm-up. Loaded by instrumentation.ts when NEXT_RUNTIME
// === "nodejs". Pre-loads the lite snapshot so the first user request lands
// on a warm in-memory cache instead of paying the 200ms (disk) or 6s (Redis)
// cold-load cost.
import { readAllLite } from "@/lib/products-store";

const t0 = Date.now();
readAllLite()
  .then((items) => {
    console.log(`[boot] products lite cache warmed: ${items.length} items in ${Date.now() - t0}ms`);
  })
  .catch((e) => {
    // Non-fatal — the dashboard will warm itself on the first user request.
    console.error("[boot] cache warmup failed (non-fatal):", e);
  });
