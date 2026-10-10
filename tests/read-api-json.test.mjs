import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

test('HTML gateway errors show status instead of Safari parser errors', async () => {
  const reader = sourceLoader({})("@/lib/read-api-json");
  await assert.rejects(reader.readApiJson(new Response('<html>Bad Gateway</html>', {status:502})), /HTTP 502/);
  await assert.rejects(reader.readApiJson(new Response('{"error":"Некоректний період"}', {status:400})), /Некоректний період/);
});
test('temporary gateway failures retry once and preserve the request signal', async () => {
  let calls=0;
  const controller=new AbortController();
  const reader=sourceLoader({globals:{fetch:async (_url, init)=>{
    assert.equal(init.signal,controller.signal);calls++;
    return calls===1?new Response('Bad Gateway',{status:502}):Response.json({total:1142});
  }}})("@/lib/read-api-json");
  assert.equal((await reader.fetchApiJson('/test',{signal:controller.signal})).total,1142);
  assert.equal(calls,2);
});
test('aborted navigation does not retry', async () => {
  let calls=0;const controller=new AbortController();controller.abort();
  const reader=sourceLoader({globals:{fetch:async ()=>{calls++;return new Response('Bad Gateway',{status:502});}}})("@/lib/read-api-json");
  await assert.rejects(reader.fetchApiJson('/test',{signal:controller.signal}), /HTTP 502/);
  assert.equal(calls,1);
});
