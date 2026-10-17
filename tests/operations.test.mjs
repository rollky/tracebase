import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {retryRequest,ModelQueue,normalizeUsage} from '../core/request-policy.mjs';
import {parseFeishuLink,readFeishu,appendFeishu} from '../core/feishu.mjs';
import {exportProject,importProject} from '../core/backup.mjs';
import {checkUpdates,newerVersion} from '../core/updates.mjs';
import {Store,initialState} from '../core/storage.mjs';
import {Service} from '../core/service.mjs';
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const secretStore={has:async()=>true,get:async()=> 'test-secret',set:async()=>{},delete:async()=>{}};
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracebase-ops-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('retry honors bounded Retry-After, stops on auth errors and cancellation',async()=>{
  let count=0;const waits=[];
  const value=await retryRequest(async()=>{if(++count<3)throw Object.assign(new Error('busy'),{status:429,retryAfterMs:100000});return 'ok';},{wait:async ms=>waits.push(ms)});
  assert.equal(value,'ok');assert.deepEqual(waits,[30000,30000]);
  let auth=0;await assert.rejects(retryRequest(async()=>{auth++;throw Object.assign(new Error('auth'),{status:401});}),/auth/);assert.equal(auth,1);
  const controller=new AbortController();controller.abort();await assert.rejects(retryRequest(()=>assert.fail('must not send'),{signal:controller.signal}),{name:'AbortError'});
});
test('model queue serializes requests and usage never treats missing values as zero',async()=>{
  const queue=new ModelQueue();let active=0,max=0;const work=()=>queue.run(async()=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,10));active--;},{intervalMs:0});
  await Promise.all([work(),work(),work()]);assert.equal(max,1);
  assert.equal(normalizeUsage(null),null);assert.equal(normalizeUsage({prompt_tokens:1}),null);assert.deepEqual(normalizeUsage({prompt_tokens:3,completion_tokens:4}),{input:3,output:4,total:7});
});
test('backup excludes paths, credentials and executable task metadata; restore is isolated',()=>{
  const original={id:'p',name:'项目',description:'test',sources:[{name:'src',root:'/private/company',remote:{text:'raw source'}}],models:{key:'secret'},articles:[{id:'a',title:'规则',body:'正文',domain:'订单',status:'reviewed',sources:[],questions:[],history:[{body:'旧版',at:'yesterday'}]}],jobs:[{config:{key:'secret'}}]};
  const text=exportProject(original);assert.ok(!text.includes('secret'));assert.ok(!text.includes('/private/company'));assert.ok(!text.includes('raw source'));
  const restored=importProject(text);assert.notEqual(restored.id,original.id);assert.equal(restored.articles[0].body,'正文');assert.equal(restored.articles[0].stale,true);assert.equal(restored.articles[0].status,'draft');assert.deepEqual(restored.sources,[]);assert.deepEqual(restored.jobs,[]);
  assert.throws(()=>importProject('{"format":"wrong","version":1}'),/不支持/);
});
test('workspace migration preserves original file and rejects future schemas',async t=>{
  const dir=await temporary(t),state={...initialState(),schema:1};await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify(state));
  const store=new Store(dir);await store.load();assert.equal(store.state.schema,2);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'workspace.schema1.bak'),'utf8')).schema,1);
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({...state,schema:999}));await assert.rejects(new Store(dir).load(),/版本/);
});
test('Feishu link parsing restricts hosts and wiki resolves only to docx',async()=>{
  assert.equal(parseFeishuLink('https://team.feishu.cn/wiki/Node123?from=share').token,'Node123');
  for(const url of ['http://team.feishu.cn/docx/a','https://feishu.cn.evil.test/docx/a','https://localhost/docx/a','https://user:pass@team.feishu.cn/docx/a'])assert.throws(()=>parseFeishuLink(url));
  let metadata=0;
  const fetcher=async url=>{assert.ok(url.startsWith('https://open.feishu.cn/open-apis/'));if(url.includes('/auth/'))return response({code:0,tenant_access_token:'token'});if(url.includes('get_node'))return response({code:0,data:{node:{obj_type:'docx',obj_token:'Doc123',space_id:'space',node_token:'Node123'}}});if(url.includes('raw_content'))return response({code:0,data:{content:'业务正文'}});metadata++;return response({code:0,data:{document:{title:'规则',revision_id:3}}});};
  const doc=await readFeishu({appId:'id'},'secret','https://team.feishu.cn/wiki/Node123',{fetcher});assert.equal(doc.text,'业务正文');assert.equal(doc.wiki.spaceId,'space');assert.equal(metadata,2);
});
test('Feishu read rejects revisions changed during download',async()=>{
  let revision=0;const fetcher=async url=>url.includes('/auth/')?response({code:0,tenant_access_token:'token'}):url.includes('raw_content')?response({code:0,data:{content:'text'}}):response({code:0,data:{document:{revision_id:++revision}}});
  await assert.rejects(readFeishu({appId:'id'},'secret','https://team.feishu.cn/docx/Doc123',{fetcher}),/发生修改/);
});
test('Feishu append detects preflight conflict and preserves partial progress',async()=>{
  let writes=0;const fetcher=async(url,options)=>{if(url.includes('/auth/'))return response({code:0,tenant_access_token:'token'});if(options.method==='GET')return response({code:0,data:{document:{revision_id:5}}});writes++;if(writes===2)return new Response('',{status:503});return response({code:0,data:{document_revision_id:6}});};
  await assert.rejects(appendFeishu({appId:'id'},'secret','Doc123','hello',4,{fetcher}),/已变化/);assert.equal(writes,0);
  await assert.rejects(appendFeishu({appId:'id'},'secret','Doc123',Array(81).fill('line').join('\n'),5,{fetcher}),e=>e.partial.written===40&&e.partial.revision===6);assert.equal(writes,2);
});
test('imported Feishu snapshots refresh and invalidate knowledge but protect local edits',async t=>{
  const store=new Store(await temporary(t));await store.load();let revision=1,text='初始规则';
  const fetcher=async url=>url.includes('/auth/')?response({code:0,tenant_access_token:'token'}):url.includes('raw_content')?response({code:0,data:{content:text}}):response({code:0,data:{document:{title:'在线规则',revision_id:revision}}});
  const service=new Service(store,secretStore,{fetcher});store.state.feishu.appId='id';const id=await service.createProject({name:'测试'});
  await service.importFeishu(id,'https://team.feishu.cn/docx/Doc123',1);const p=service.project(id),file=p.index.files[0],source=p.sources[0];assert.equal(file.revision,'飞书 r1');
  p.articles.push({id:'a',sources:[{fileId:file.id,hash:file.hash}]});revision=2;text='新规则';await service.refreshFeishu(id,source.id);assert.equal(p.articles[0].stale,true);
  await fs.writeFile(path.join(source.root,'document.md'),'人工修改');await assert.rejects(service.refreshFeishu(id,source.id),/本地文档快照已被修改/);
});
test('scheduled scans run only when due and never invoke a model',async t=>{
  const store=new Store(await temporary(t));await store.load();const service=new Service(store,secretStore,{fetcher:()=>assert.fail('must not call model')});const id=await service.createProject({name:'计划'});await service.saveSchedule(id,{enabled:true,minutes:15});const p=service.project(id);let scans=0;service.scan=async()=>scans++;
  await service.scanDueProjects();assert.equal(scans,0);p.scanSchedule.nextAt='2000-01-01T00:00:00Z';await service.scanDueProjects();assert.equal(scans,1);await service.scanDueProjects();assert.equal(scans,1);
});
test('update checks compare numeric versions and construct trusted links',async()=>{
  assert.equal(newerVersion('0.9.0','v0.10.0'),true);assert.equal(newerVersion('1.0.0','v0.10.0'),false);
  const result=await checkUpdates('0.2.0',{fetcher:async()=>response({tag_name:'v0.3.0',html_url:'https://evil.test'})});assert.equal(result.url,'https://github.com/rollky/tracebase/releases/tag/v0.3.0');assert.equal(result.available,true);
});

test('restored knowledge reattaches unique paths while staying unreviewed and stale',async t=>{
  const dir=await temporary(t),store=new Store(path.join(dir,'state'));await store.load();
  const service=new Service(store,secretStore),root=path.join(dir,'source');await fs.mkdir(root);await fs.writeFile(path.join(root,'rules.md'),'订单规则');
  const original={name:'备份',sources:[],articles:[{id:'a',title:'规则',body:'订单',sources:[{fileId:'old',path:'rules.md',hash:'oldhash',start:1,end:1}]}]};
  const id=await service.restoreProject(exportProject(original));await service.addSources(id,[{name:'资料',root,kind:'folder'}]);await service.scan(id);
  const p=service.project(id);assert.equal(p.articles[0].sources[0].fileId,p.index.files[0].id);assert.equal(p.articles[0].sources[0].hash,'oldhash');assert.equal(p.articles[0].stale,true);assert.equal(p.articles[0].status,'draft');
  service.importing.add(id);await assert.rejects(service.removeSource(id,p.sources[0].id),/任务/);await assert.rejects(service.scan(id),/任务/);
});
