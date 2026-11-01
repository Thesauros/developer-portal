// A name used but never declared throws only when that line runs, and a try/catch
// can hide it entirely: a deleted ABI once dropped requests from the list while
// every test passed. This fails the build on any undeclared name in app code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const parser = require("next/dist/compiled/babel/parser");
const walked = require("next/dist/compiled/babel/traverse");
const traverse = walked.default || walked;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBALS = new Set(
  "window document location history fetch Date Math Number BigInt JSON Set Map WeakMap WeakSet String Boolean Promise Array Object Error TypeError ReferenceError RangeError console process localStorage sessionStorage setInterval clearInterval setTimeout clearTimeout requestAnimationFrame cancelAnimationFrame AbortSignal AbortController ResizeObserver IntersectionObserver MutationObserver URL URLSearchParams encodeURIComponent decodeURIComponent undefined globalThis Response Request Headers NaN Infinity RegExp navigator Intl parseInt parseFloat isNaN isFinite crypto TextEncoder TextDecoder CustomEvent Event Symbol arguments isSecureContext Buffer FormData Blob atob btoa structuredClone Uint8Array ArrayBuffer DataView getComputedStyle performance Reflect Proxy require module __dirname addEventListener removeEventListener".split(
    " ",
  ),
);
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" ? [] : files(path);
    return /\.(jsx?|mjs)$/.test(name) ? [path] : [];
  });
}
const problems = [];
for (const file of [...files(join(root, "app")), ...files(join(root, "lib"))]) {
  const ast = parser.parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["jsx"],
  });
  traverse(ast, {
    ReferencedIdentifier(path) {
      const { name } = path.node;
      if (!path.scope.hasBinding(name, true) && !GLOBALS.has(name))
        problems.push(`${file.replace(root + "/", "")}: ${name}`);
    },
  });
}
assert.deepEqual([...new Set(problems)], []);
console.log("no undeclared names in app or lib");
