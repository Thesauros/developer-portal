import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encrypt,decrypt,_resetKey} from '../lib/api/crypto.js';

process.env.ENCRYPTION_KEY=randomBytes(32).toString('hex');
_resetKey();
for(const value of ['', 'sandbox secret', 'Unicode: привет']) {
  assert.equal(decrypt(encrypt(value)),value);
}
const empty=Buffer.from(encrypt('').slice(4),'base64');
assert.throws(()=>decrypt('enc:'+empty.subarray(0,12+8).toString('base64')));
const tampered=Buffer.from(encrypt('sandbox secret').slice(4),'base64');
tampered[tampered.length-1]^=1;
assert.throws(()=>decrypt('enc:'+tampered.toString('base64')));
assert.equal(decrypt('existing sandbox seed'),'existing sandbox seed');
console.log('PASS: encryption round trips, full authentication tag required, ciphertext tampering rejected, seed compatibility.');
