import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "thesauros-vercel-test-"));
const moduleUrl = (path) => new URL(path, import.meta.url).href;
const env = { ...process.env, VERCEL: "1", TMPDIR: directory };
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;
function run(code) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      env,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
try {
  run(`
    import assert from 'node:assert/strict';
    await assert.rejects(import(${JSON.stringify(moduleUrl("../lib/auth.mjs"))}),
      /Vercel requires persistent account storage/);
  `);
  run(`
    import assert from 'node:assert/strict';
    const {cachedSource} = await import(${JSON.stringify(moduleUrl("../lib/live-data.mjs"))});
    await import(${JSON.stringify(moduleUrl("../lib/rebalances.mjs"))});
    globalThis.fetch = async () => Response.json({observed: 42});
    const result = await cachedSource('vercel-storage-test', 'https://example.test');
    assert.equal(result.data.observed, 42);
    assert.equal(result.stale, false);
  `);
  assert.ok(
    existsSync(
      join(directory, "thesauros-live-cache/vercel-storage-test.json"),
    ),
  );
  run(`
    import assert from 'node:assert/strict';
    const {cachedSource} = await import(${JSON.stringify(moduleUrl("../lib/live-data.mjs"))});
    globalThis.fetch = async () => { throw new Error('Source offline'); };
    const result = await cachedSource('vercel-storage-test', 'https://example.test', 0);
    assert.equal(result.data.observed, 42);
    assert.equal(result.stale, true);
  `);
  console.log(
    "PASS: Vercel requires external account storage; disposable caches persist across process restarts in the temporary directory.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
