import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
/** Executes real TS in an isolated module graph, with explicit I/O substitutes. */
export function sourceLoader({
  mocks = {},
  append = {},
  sources = {},
  globals = {},
} = {}) {
  const loaded = new Map();
  function load(name) {
    if (name in mocks) return mocks[name];
    if (!name.startsWith("@/")) return nativeRequire(name);
    if (loaded.has(name)) return loaded.get(name);
    const filename = path.resolve("src", `${name.slice(2)}.ts`);
    const source =
      (sources[name] ?? fs.readFileSync(filename, "utf8")) +
      (append[name] || "");
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const loadedModule = { exports: {} };
    loaded.set(name, loadedModule.exports);
    vm.runInNewContext(
      code,
      {
        module: loadedModule,
        exports: loadedModule.exports,
        require: load,
        console,
        process: { env: {}, cwd: () => process.cwd(), pid: process.pid },
        Date,
        Map,
        Set,
        Intl,
        URL,
        URLSearchParams,
        Buffer,
        performance,
        global: {},
        ...globals,
      },
      { filename },
    );
    return loadedModule.exports;
  }
  return load;
}
