// Temporary, pinned-version diagnostics. This branch is never merged.
import { readFile, writeFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const testRequire = createRequire(
  require.resolve("@playwright/test/package.json"),
);
const playwrightRequire = createRequire(
  testRequire.resolve("playwright/package.json"),
);
const bundle = join(
  dirname(playwrightRequire.resolve("playwright-core/package.json")),
  "lib/coreBundle.js",
);
let source = await readFile(bundle, "utf8");
const start = source.indexOf("    WKSession = class extends");
const end = source.indexOf(
  "// packages/playwright-core/src/server/webkit/wkExecutionContext.ts",
  start,
);
if (start < 0 || end < 0) throw new Error("Unexpected Playwright bundle");
let session = source.slice(start, end);
const original = `        return new Promise((resolve, reject) => {
          this._callbacks.set(id, { resolve, reject, error: new ProtocolError("error", method) });
        });`;
if (session.split(original).length !== 2)
  throw new Error("Unexpected WKSession send");
session = session.replace(
  original,
  `        const result = new Promise((resolve, reject) => {
          this._callbacks.set(id, { resolve, reject, error: new ProtocolError("error", method) });
        });
        if (method === "Input.dispatchKeyEvent" && params2?.key === "Enter") {
          const started = Date.now();
          console.error("WK_KEY_SEND", this.sessionId, params2.type, started);
          result.then(
            () => console.error("WK_KEY_DONE", this.sessionId, params2.type, Date.now() - started),
            error => console.error("WK_KEY_ERROR", String(error))
          );
          const timer = setTimeout(() => {
            if (this._callbacks.has(id))
              console.error("WK_KEY_STALLED", this.sessionId, params2.type, Date.now());
          }, 3000);
          timer.unref();
        }
        return result;`,
);
source = source.slice(0, start) + session + source.slice(end);
// Break this checkout's hard link without mutating the shared pnpm store.
await writeFile(`${bundle}.diagnostic`, source);
await rename(`${bundle}.diagnostic`, bundle);
console.log("Installed temporary WebKit key-dispatch latency diagnostics");
