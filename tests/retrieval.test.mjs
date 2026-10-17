import test from 'node:test';
import assert from 'node:assert/strict';
import {retrieve,parseAnswer,normalizeScope} from '../core/retrieval.mjs';
const article={id:'a',title:'订单取消',domain:'订单',body:'待支付订单允许用户取消。\n已发货必须进入售后。',status:'draft',sources:[]};
test('Chinese retrieval excludes stale and replacement drafts',()=>{
  const found=retrieve([article,{...article,id:'stale',stale:true},{...article,id:'replacement',replacesArticleId:'a'},{...article,id:'other',title:'库存',domain:'库存',body:'库存扣减'}],'什么情况能取消订单？');
  assert.deepEqual(found.map(a=>a.id),['a']);assert.equal(found[0].status,'draft');assert.equal(retrieve([article],'database replication').length,0);
});
test('scope filters domain and reviewed status before ranking and validates bounds',()=>{
  const articles=[article,{...article,id:'b',status:'reviewed'},{...article,id:'c',domain:'售后',status:'reviewed'}];
  assert.deepEqual(retrieve(articles,'取消',{domain:'订单',status:'reviewed',limit:3}).map(a=>a.id),['b']);
  assert.equal(retrieve(articles,'取消',{domain:'不存在'}).length,0);
  for(const scope of [{limit:100},{status:'unknown'},{domain:[]},null])assert.throws(()=>normalizeScope(scope),/范围/);
});
test('passages rank late matches, bound payloads and preserve exact line positions',()=>{
  const body=Array.from({length:120},(_,i)=>i===110?'特殊取消规则允许退款':'普通内容'.repeat(20)).join('\n');
  const found=retrieve([{...article,title:'说明',domain:'业务',body}],'特殊取消规则');
  assert.ok(found[0].excerpt.includes('特殊取消规则'));assert.ok(found.every(c=>c.excerpt.length<=1600));assert.ok(found.length<=2);
  const parsed=parseAnswer(JSON.stringify({answer:'可以退款。[K1]',references:[{passageId:'K1',quote:'特殊取消规则允许退款'}]}),found);
  assert.equal(parsed.references[0].start,111);assert.equal(parsed.references[0].end,111);
});
test('answer citations must match exact quotes and markers with no invented references',()=>{
  const candidates=retrieve([article],'取消'),valid={answer:'可以取消。[K1]',references:[{passageId:'K1',quote:'待支付订单允许用户取消。'}]};
  const parsed=parseAnswer(JSON.stringify(valid),candidates);assert.equal(parsed.references[0].id,'a');assert.equal(parsed.references[0].start,1);
  for(const invalid of [{...valid,references:[{passageId:'K2',quote:'待支付订单允许用户取消。'}]},{...valid,references:[{passageId:'K1',quote:'任何订单都能取消'}]},{...valid,answer:'可以取消'},{...valid,answer:'可以取消。[K9]'},{...valid,references:['a']}])assert.throws(()=>parseAnswer(JSON.stringify(invalid),candidates),/引用/);
});
test('multiline quotes calculate knowledge lines and long single lines remain bounded',()=>{
  const found=retrieve([article],'售后');const parsed=parseAnswer(JSON.stringify({answer:'规则。[K1]',references:[{passageId:'K1',quote:article.body}]}),found);assert.equal(parsed.references[0].end,2);
  const long=retrieve([{...article,body:'取消'.repeat(5000)}],'取消');assert.equal(long.length,2);assert.ok(long.every(c=>c.start===1&&c.end===1&&c.excerpt.length<=1600));
});
