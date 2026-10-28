import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRouteId} from '../lib/route-id.mjs';
test('encoded sale IDs and already-decoded params identify the same exact pack release',()=>{
 const id='magical-dribblers-22-oct-26::2026-10';
 assert.equal(decodeRouteId(encodeURIComponent(id)),id);
 assert.equal(decodeRouteId(id),id);
 assert.notEqual(decodeRouteId(encodeURIComponent('magical-dribblers-22-oct-26::2026-11')),id);
});
test('numeric card IDs remain strings without precision loss',()=>{
 assert.equal(decodeRouteId('106800804376628'),'106800804376628');
 assert.equal(decodeRouteId('%31%30%36%38%30%30%38%30%34%33%37%36%36%32%38'),'106800804376628');
});
test('malformed, nested-encoded, path separator and control inputs fail closed',()=>{
 for(const value of ['%', '%E0%A4%A', '%252F', '%2F', '%5C', '%00', 'a/b', '', 'x'.repeat(1537), null])assert.equal(decodeRouteId(value),'');
});
