// Capture today's zero point once, without altering or deleting catalogue data.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import ts from "typescript";

const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error("Usage: node scripts/start-inactive-tracking.mjs <daily-snapshot.json.gz>");
const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(snapshotPath)).toString("utf8"));
if (!Array.isArray(snapshot.products) || !snapshot.syncedAt) throw new Error("Invalid product snapshot");
process.env.PRODUCT_SNAPSHOTS_DIR ||= path.dirname(path.resolve(snapshotPath));
const filename = path.resolve("src/lib/product-inactive-tracking.ts");
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
const compiled = {exports: {}};
new Function("require", "module", "exports", code)(createRequire(import.meta.url), compiled, compiled.exports);
const {readInactiveTracking, updateInactiveTracking} = compiled.exports;
const existing = readInactiveTracking();
const state = existing || updateInactiveTracking(snapshot.products, snapshot.syncedAt);
console.log(JSON.stringify({initialized: !existing, startedAt: state.startedAt,
  products: snapshot.products.length, tracked: state.trackedIds.length, current: state.current.length}));
