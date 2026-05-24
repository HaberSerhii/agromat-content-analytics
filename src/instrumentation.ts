// Next.js boot hook. The actual warm-up logic lives in instrumentation-node.ts
// so webpack only follows that import chain (which pulls in fs/path/zlib via
// products-disk-cache) when compiling for the Node runtime. Without this
// split, the edge-runtime compilation pass fails with "Can't resolve 'fs'".
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
