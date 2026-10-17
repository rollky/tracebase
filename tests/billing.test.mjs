import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensureBilling,setRate,setBudget,recordUsage,monthSummary,reconcileMonth,assertBudget,recoverPendingBilling,usageCsv} from '../core/billing.mjs';
import {Store} from '../core/storage.mjs';
import {Service} from '../core/service.mjs';
const config={baseUrl:'https://example.test/v1',model:'test'},at='2026-10-17T00:00:00Z';
const event=(overrides={})=>({at,...config,rate:{input:2,output:4},usage:{input:1000000,output:500000,total:1500000},success:true,...overrides});
test('cost uses per-request rates, keeps unknown separate and scopes prices to endpoint',()=>{
  const b=ensureBilling({});setRate(b,config,{input:2,output:4});recordUsage(b,event());setRate(b,config,{input:20,output:40});recordUsage(b,event({usage:null}));recordUsage(b,event({rate:null}));
  const s=monthSummary(b,'2026-10');assert.equal(s.cost,4);assert.equal(s.unknownUsage,1);assert.equal(s.unpriced,1);assert.equal(b.months[0].input,2000000);
  setBudget(b,{enabled:true,monthlyLimit:100});assert.throws(()=>assertBudget(b,{...config,baseUrl:'https://other.test'},'2026-10'),/单价/);assert.throws(()=>assertBudget(b,config,'2026-10'),/未知/);
});
test('reconciliation covers past uncertainty without deleting records and future requests add cost',()=>{
  const b=ensureBilling({});setRate(b,config,{input:2,output:4});setBudget(b,{enabled:true,monthlyLimit:10});recordUsage(b,event({usage:null}));reconcileMonth(b,7,'2026-10');assertBudget(b,config,'2026-10');recordUsage(b,event());
  assert.equal(monthSummary(b,'2026-10').budgetUsed,11);assert.equal(monthSummary(b,'2026-10').unknownUsage,1);assert.throws(()=>assertBudget(b,config,'2026-10'),/预算阈值/);assertBudget(b,config,'2026-11');
});
test('ledger survives short event log retention and exports spreadsheet-safe CSV',()=>{
  const b=ensureBilling({});for(let i=0;i<501;i++)recordUsage(b,event({model:'=BAD()'}));assert.equal(b.months[0].requests,501);assert.ok(usageCsv(b).includes("'=BAD()"));
  for(let i=0;i<40;i++)recordUsage(b,event({at:new Date(Date.UTC(2020, i,1)).toISOString()}));assert.equal(new Set(b.months.map(r=>r.month)).size,36);
  for(const value of [-1,NaN,Infinity,'1'])assert.throws(()=>setRate(b,config,{input:value,output:1}));
});
test('interrupted requests become uncertain exactly once on recovery',()=>{
  const state={usageEvents:[{...event(),billingState:'pending'}]};assert.equal(recoverPendingBilling(state),true);assert.equal(recoverPendingBilling(state),false);const s=monthSummary(state.billing,'2026-10');assert.equal(s.requests,1);assert.equal(s.unknownUsage,1);assert.equal(s.cost,0);
});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracebase-billing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Store(dir);await store.load();store.state.models=config;store.state.runtime={intervalMs:0,retries:0};return {store,dir};}
test('queued concurrent requests check latest budget before sending and persist totals',async t=>{
  const {store,dir}=await setup(t);let sends=0;const service=new Service(store,{}, {fetcher:async()=>{sends++;return new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:1000000,completion_tokens:0}}));}});
  await service.saveModelRate({input:2,output:4});await service.saveBudget({enabled:true,monthlyLimit:1});
  const results=await Promise.allSettled([service.modelRequest(config,'key',[{role:'user',content:'test'}]),service.modelRequest(config,'key',[{role:'user',content:'test'}])]);assert.equal(sends,1);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/预算阈值/);
  const restored=new Store(dir);await restored.load();assert.equal(monthSummary(restored.state.billing).cost,2);assert.equal(restored.state.usageEvents[0].billingState,'completed');
});
test('missing usage blocks the next budgeted request; no fake zero-charge events on rejection',async t=>{
  const {store}=await setup(t);let sends=0;const service=new Service(store,{}, {fetcher:async()=>{sends++;return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}));}});await service.saveModelRate({input:1,output:1});await service.saveBudget({enabled:true,monthlyLimit:10});
  await service.modelRequest(config,'key',[]);await assert.rejects(service.modelRequest(config,'key',[]),/未知/);assert.equal(sends,1);assert.equal(store.state.usageEvents.length,1);await service.reconcileBudget(1);await service.modelRequest(config,'key',[]);assert.equal(sends,2);
});
