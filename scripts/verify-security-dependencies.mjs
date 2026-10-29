import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const next = require('next/package.json');
const sharpPackage = { version: require('sharp').versions.sharp };
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
const tuple = version => version.split('.').slice(0, 3).map(Number);
const atLeast = (version, minimum) => {
  const actual = tuple(version);
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
};
const expectedNextMajor = 16;
assert.equal(tuple(next.version)[0], expectedNextMajor, 'Preserve the reviewed Next major');
assert.ok(atLeast(next.version, expectedNextMajor === 15 ? [15, 5, 28] : [16, 4, 1]));
assert.ok(atLeast(sharpPackage.version, [0, 35, 5]));
const fromNext = createRequire(require.resolve('next/package.json'));
assert.equal(fromNext('sharp').versions.sharp, sharpPackage.version,
  'Next must resolve the patched image processor');
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path.endsWith('node_modules/sharp'))
    assert.ok(atLeast(entry.version, [0, 35, 5]), 'No old sharp copy in lock: ' + path);
}
// Exercise the installed native module with a tiny benign generated image.
const sharp = fromNext('sharp');
const png = await sharp({ create: { width: 1, height: 1, channels: 3,
  background: { r: 0, g: 0, b: 0 } } }).resize(2, 2).png().toBuffer();
const metadata = await sharp(png).metadata();
assert.equal(metadata.width, 2);
assert.equal(metadata.height, 2);
console.log('PASS: patched Next ' + next.version + '/sharp ' + sharpPackage.version +
  ', matching lock/runtime resolution and benign native image processing.');
