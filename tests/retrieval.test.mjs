import test from 'node:test';
import assert from 'node:assert/strict';
import {retrieve,parseAnswer} from '../core/retrieval.mjs';
const article={id:'a',title:'订单取消',domain:'订单',body:'待支付订单允许用户取消。已发货必须进入售后。',status:'draft',sources:[]};
test('Chinese retrieval finds relevant knowledge and excludes stale and replacement drafts',()=>{
  const found=retrieve([article,{...article,id:'stale',stale:true},{...article,id:'replacement',replacesArticleId:'a'},{...article,id:'other',title:'库存',domain:'库存',body:'库存扣减'}],'什么情况能取消订单？');
  assert.deepEqual(found.map(a=>a.id),['a']);assert.equal(found[0].status,'draft');assert.equal(retrieve([article],'database replication').length,0);
});
test('answers require existing knowledge references, never invented evidence',()=>{
  assert.deepEqual(parseAnswer('{"answer":"允许取消","references":["a","invented","a"]}',[article]),{answer:'允许取消',references:['a']});
  assert.throws(()=>parseAnswer('{"answer":"猜测","references":["invented"]}',[article]),/有效知识引用/);
});
