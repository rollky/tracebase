import test from 'node:test';
import assert from 'node:assert/strict';
import {PROVIDERS,providerParameters} from '../core/providers.mjs';
import {chat} from '../core/model.mjs';
test('Kimi defaults match the current official compatible endpoint',()=>{
  assert.equal(PROVIDERS.kimi.baseUrl,'https://api.moonshot.cn/v1');
  assert.equal(PROVIDERS.kimi.model,'kimi-k3');
  assert.ok(PROVIDERS.kimi.models.includes('kimi-k2.6'));
});
test('Kimi models receive only parameters supported by that model family',()=>{
  const k3=providerParameters({provider:'kimi',model:'kimi-k3'},5000);
  assert.equal(k3.reasoning_effort,'high');assert.equal(k3.max_tokens,16000);assert.ok(!('thinking' in k3));assert.ok(!('temperature' in k3));
  assert.deepEqual(providerParameters({provider:'kimi',model:'kimi-k2.6'},5000),{max_tokens:5000,thinking:{type:'disabled'}});
  assert.deepEqual(providerParameters({provider:'kimi',model:'kimi-k2.7-code'},5000),{max_tokens:16000});
  assert.deepEqual(providerParameters({provider:'custom',model:'other'},5000),{max_tokens:5000});
});
test('Kimi connection test uses a reasoning budget instead of the generic 32-token limit',async()=>{
  let sent;
  await chat({...PROVIDERS.kimi,provider:'kimi'},'test-key',[{role:'user',content:'Reply OK'}],{maxTokens:32,fetcher:async(url,options)=>{assert.equal(url,'https://api.moonshot.cn/v1/chat/completions');sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}]}));}});
  assert.equal(sent.reasoning_effort,'low');assert.equal(sent.max_tokens,4096);assert.ok(!('thinking' in sent));
});
