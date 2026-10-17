import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {extractStructure,buildGraph,expandContext,impactedFiles} from '../core/structure.mjs';
import {Store} from '../core/storage.mjs';
import {Service} from '../core/service.mjs';

test('AST distinguishes code from comments and extracts evidence positions',()=>{
  const result=extractStructure('api.ts',`// import fake from './fake'; router.get('/fake',handler)
import {cancel} from './orders.js';
export const handle = () => cancel();
router.post('/cancel',handle);
const sql = 'SELECT * FROM orders JOIN payments ON true';`);
  assert.deepEqual(result.imports,[{specifier:'./orders.js',line:2}]);
  assert.equal(result.symbols[0].name,'handle');assert.equal(result.symbols[0].start,3);
  assert.deepEqual(result.routes.map(r=>r.path),['/cancel']);assert.deepEqual(result.tables.map(t=>t.name),['orders','payments']);
  assert.equal(extractStructure('legacy.java','class Order {}').parser,'text');
});
test('dependency resolution is source-local, bounded and cycle-safe; aliases remain explicit',()=>{
  const file=(id,name,sourceId,imports=[])=>({id,path:name,sourceId,structure:{imports:imports.map(specifier=>({specifier,line:1}))}});
  const files=[file('a','a.ts','s',['./b.js','@app/c','../outside']),file('b','b.ts','s',['./a','./c']),file('c','c.ts','s'),file('other','b.ts','other')];
  const graph=buildGraph(files);assert.equal(graph.edges.length,3);assert.equal(graph.unresolved.length,2);
  const context=expandContext({files,graph},['a'],{limit:2});assert.deepEqual(context.ids,['a','b']);assert.deepEqual(context.omitted,['c']);
  assert.deepEqual([...impactedFiles({graph},{graph:{edges:[]}},['c'])].sort(),['a','b','c']);
});
async function setup(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracebase-structure-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'code');await fs.mkdir(root);await fs.writeFile(path.join(root,'entry.ts'),`import {rule} from './rule';\nexport const cancel = () => rule();`);await fs.writeFile(path.join(root,'rule.ts'),'export const rule = () => true;');
  const store=new Store(path.join(dir,'state'));await store.load();const keys=new Map();const secrets={has:async k=>keys.has(k),get:async k=>keys.get(k),set:async(k,v)=>keys.set(k,v),delete:async k=>keys.delete(k)};
  let requests=[];
  const service=new Service(store,secrets,{fetcher:async(url,options)=>{const input=JSON.parse(JSON.parse(options.body).messages[1].content);requests.push(input);const p=input.parts[0];return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({articles:[{title:'取消规则',body:'当前规则允许取消',sources:[{fileId:p.fileId,start:p.start,end:p.end}],questions:[]}]})}}]}));}});
  const id=await service.createProject({name:'订单'});await service.addSources(id,[{root}]);await service.scan(id);await service.saveModel({baseUrl:'https://example.com/v1',model:'test'});
  return {service,id,root,p:service.project(id),requests};
}
async function finish(service,id){for(let i=0;i<200&&service.running.has(id);i++)await new Promise(r=>setTimeout(r,10));assert.equal(service.running.has(id),false);assert.equal(service.project(id).jobs[0].status,'completed');}
test('dependency change invalidates knowledge; reviewed updates preserve history and identity',async t=>{
  const {service,id,root,p,requests}=await setup(t);const entry=p.index.files.find(f=>f.path==='entry.ts');
  const preview=await service.previewAnalysis(id,[entry.id],{related:true});assert.equal(preview.files.length,2);assert.equal(preview.context.added.length,1);
  await service.startAnalysis(id,{fileIds:[entry.id],topic:'取消',related:true});await finish(service,id);
  assert.equal(requests[0].relationships.length,1);const original=p.articles[0],originalId=original.id;
  await service.updateArticle(id,original.id,{body:'人工补充旧规则'});
  await fs.writeFile(path.join(root,'rule.ts'),'export const rule = () => false;');await service.scan(id);assert.equal(original.stale,true);
  await service.startAnalysis(id,{fileIds:[entry.id],related:true,refreshArticleId:original.id});await finish(service,id);
  const draft=p.articles.find(a=>a.replacesArticleId);assert.ok(draft);assert.equal(original.body,'人工补充旧规则');
  await service.applyUpdate(id,draft.id);assert.equal(original.id,originalId);assert.equal(original.status,'draft');assert.equal(original.stale,false);assert.equal(original.history[0].body,'人工补充旧规则');assert.equal(p.articles.length,1);
});
test('update refuses concurrent manual edits and source changes without rescan',async t=>{
  const {service,id,root,p}=await setup(t);const entry=p.index.files.find(f=>f.path==='entry.ts');
  await service.startAnalysis(id,{fileIds:[entry.id]});await finish(service,id);const original=p.articles[0];
  await service.startAnalysis(id,{fileIds:[entry.id],refreshArticleId:original.id});await finish(service,id);const draft=p.articles.find(a=>a.replacesArticleId);
  await service.updateArticle(id,original.id,{body:'新人工意见'});await assert.rejects(service.applyUpdate(id,draft.id),/已被修改/);assert.equal(original.body,'新人工意见');
  await service.startAnalysis(id,{fileIds:[entry.id],refreshArticleId:original.id});await finish(service,id);const newest=p.articles.at(-1);
  await fs.writeFile(path.join(root,'entry.ts'),'changed');await assert.rejects(service.applyUpdate(id,newest.id),/变化/);assert.equal(original.body,'新人工意见');
});

test('failed batches resume after reload without duplicating completed drafts',async t=>{
  const {service,id,root,p}=await setup(t);
  await fs.writeFile(path.join(root,'large.ts'),Array.from({length:1400},(_,i)=>`export const value${i} = ${i};`).join('\n'));await service.scan(id);
  const file=p.index.files.find(f=>f.path==='large.ts'),fetcher=service.fetcher;let requests=0;
  service.fetcher=async(...args)=>{if(++requests===2)throw new Error('simulated outage');return fetcher(...args);};
  await service.startAnalysis(id,{fileIds:[file.id],topic:'large'});
  for(let i=0;i<200&&service.running.has(id);i++)await new Promise(r=>setTimeout(r,10));
  const job=p.jobs[0];assert.equal(job.status,'failed');assert.equal(job.completed,1);const first=job.articleIds[0];
  const restored=new Store(service.store.directory);await restored.load();const next=new Service(restored,service.secrets,{fetcher});
  await next.resumeAnalysis(id,job.id);await finish(next,id);
  const completed=next.project(id).jobs[0];assert.equal(completed.articleIds.filter(id=>id===first).length,1);assert.equal(completed.completed,completed.total);
});

test('question preview prevents changed knowledge from being sent and saves valid references',async t=>{
  const {service,id,p}=await setup(t);const file=p.index.files[0];await service.startAnalysis(id,{fileIds:[file.id]});await finish(service,id);
  const pack=await service.previewQuestion(id,'取消规则');assert.equal(pack.candidates.length,1);let sent=0;
  service.fetcher=async()=>{sent++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'根据草稿，允许取消。',references:[p.articles[0].id]})}}]}));};
  await service.updateArticle(id,p.articles[0].id,{body:'取消规则需要管理员批准'});
  await assert.rejects(service.answerQuestion(id,'取消规则',pack.fingerprint),/已变化/);assert.equal(sent,0);
  const latest=await service.previewQuestion(id,'取消规则');await service.answerQuestion(id,'取消规则',latest.fingerprint);
  assert.equal(p.answers.length,1);assert.equal(p.answers[0].references[0].id,p.articles[0].id);
});
