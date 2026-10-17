import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectKnowledge} from '../core/quality.mjs';
import {Service} from '../core/service.mjs';
import {Store} from '../core/storage.mjs';
const article=(id,body='订单必须核对用户身份，然后执行取消订单操作。')=>({id,title:'订单规则',domain:'订单',body,status:'draft',sources:[],questions:['是否需要审批？'],history:[]});
test('quality finds exact cross-domain copies, excludes update proposals and flags wording differences',()=>{
  const base=article('a'),copy={...base,id:'b',domain:'其他',body:'  '+base.body+'  '},changed=article('c',base.body+'不得取消。');
  const result=inspectKnowledge([base,copy,changed,{...base,id:'proposal',replacesArticleId:'a'}]);
  assert.equal(result.eligible,3);assert.ok(result.pairs.some(p=>p.kind==='exact'&&p.right==='b'));assert.ok(result.pairs.some(p=>p.review&&p.right==='c'));
  assert.equal(inspectKnowledge([base,article('other','完全不同的库存规则')]).pairs.length,0);
});
test('quality exposes scan and result limits without treating them as complete',()=>{
  const report=inspectKnowledge(Array.from({length:510},(_,i)=>article(String(i))));assert.equal(report.examined,500);assert.equal(report.compared,50000);assert.equal(report.pairs.length,100);assert.equal(report.limited,true);
  assert.equal(inspectKnowledge([article('long','a'.repeat(12001))]).limited,true);
});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracebase-quality-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Store(dir);await store.load();const service=new Service(store,{}),id=await service.createProject({name:'知识检查'});service.project(id).articles=[article('a'),article('b')];return {service,id,p:service.project(id)};}
test('dismissals are reversible and only apply to the checked knowledge versions',async t=>{
  const {service,id,p}=await setup(t);let report=await service.inspectQuality(id);const stamp=report.pairs[0].stamp;await service.dismissQuality(id,stamp,true);assert.equal((await service.inspectQuality(id)).pairs[0].dismissed,true);
  await service.dismissQuality(id,stamp,false);assert.equal((await service.inspectQuality(id)).pairs[0].dismissed,false);
  p.articles[0].body+='补充';await assert.rejects(service.dismissQuality(id,stamp,true),/已变化/);
});
test('consolidation creates draft with originals intact and rejects stale or repeated versions',async t=>{
  const {service,id,p}=await setup(t);const stamp=(await service.inspectQuality(id)).pairs[0].stamp,original=JSON.stringify(p.articles);
  const aid=await service.consolidateKnowledge(id,{stamp,title:'整合规则',body:'核对身份后取消订单。'});assert.equal(JSON.stringify(p.articles.slice(0,2)),original);const a=p.articles.find(x=>x.id===aid);assert.equal(a.status,'draft');assert.deepEqual(a.consolidatedFrom.map(x=>x.id),['a','b']);assert.equal(a.questions.length,1);
  await assert.rejects(service.consolidateKnowledge(id,{stamp,title:'重复',body:'重复'}),/已经/);
  p.articles[0].stale=true;const next=(await service.inspectQuality(id)).pairs.find(x=>x.left==='a'&&x.right==='b');await assert.rejects(service.consolidateKnowledge(id,{stamp:next.stamp,title:'整合',body:'内容'}),/来源已变化/);
});
test('consolidation validates actual evidence instead of trusting the saved index',async t=>{
  const {service,id,p}=await setup(t);const root=path.join(service.store.directory,'source');await fs.mkdir(root);await fs.writeFile(path.join(root,'rule.md'),'旧规则');await service.addSources(id,[{root,name:'规则',kind:'folder'}]);await service.scan(id);const f=p.index.files[0];for(const a of p.articles){a.stale=false;a.sources=[{fileId:f.id,path:f.path,hash:f.hash,start:1,end:1}];}
  const stamp=(await service.inspectQuality(id)).pairs[0].stamp;await fs.writeFile(path.join(root,'rule.md'),'新规则');await assert.rejects(service.consolidateKnowledge(id,{stamp,title:'合并',body:'规则'}),/变化/);assert.equal(p.articles.length,2);
});
