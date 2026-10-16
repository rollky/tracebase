import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scanSources,safePath,readEvidence,makeChunks,compareIndex,parseSvn,extractText} from '../core/scanner.mjs';
import {chat,parseAnalysis,normalizeEndpoint} from '../core/model.mjs';
import {Store,articleMarkdown} from '../core/storage.mjs';
import {Service} from '../core/service.mjs';
import {publishFeishu} from '../core/feishu.mjs';

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tracebase-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const secretStore=()=>{const values=new Map();return {has:async k=>values.has(k),get:async k=>values.get(k)||'',set:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)};};
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('scan filters dependencies, secrets, binary files and detects stale evidence',async t=>{
  const dir=await fixture(t);await fs.mkdir(path.join(dir,'src'));await fs.mkdir(path.join(dir,'node_modules'));
  await fs.writeFile(path.join(dir,'src/order.ts'),'export const canCancel = status => status === "pending";\n');
  await fs.writeFile(path.join(dir,'.env'),'KEY=private');await fs.writeFile(path.join(dir,'secrets.json'),'{"key":"private"}');
  await fs.writeFile(path.join(dir,'node_modules/unrelated.js'),'ignore');await fs.writeFile(path.join(dir,'binary.txt'),Buffer.from([0,1,2]));
  const sources=[{id:'s1',root:dir}],index=await scanSources(sources);
  assert.equal(index.files.length,1);assert.equal(index.skipped.length,1);
  const project={sources,index};const f=index.files[0];assert.match((await readEvidence(project,f.id)).text,/canCancel/);
  await fs.writeFile(path.join(dir,'src/order.ts'),'changed');await assert.rejects(readEvidence(project,f.id),/已发生变化/);
  const after=await scanSources(sources);assert.deepEqual(compareIndex(index,after).modified,[f.id]);
  await fs.unlink(path.join(dir,'src/order.ts'));const deleted=await scanSources(sources);assert.deepEqual(compareIndex(after,deleted).deleted,[f.id]);
});
test('paths cannot escape through traversal or symlinks',async t=>{
  const dir=await fixture(t);const root=path.join(dir,'root');await fs.mkdir(root);await fs.writeFile(path.join(dir,'outside.txt'),'secret');
  await assert.rejects(safePath(root,'../outside.txt'),/授权目录/);
  await fs.symlink(path.join(dir,'outside.txt'),path.join(root,'link.txt'));await assert.rejects(safePath(root,'link.txt'),/授权目录/);
});
test('Word and PDF text are extracted without requiring installed office software',async()=>{
  const {zipSync,strToU8}=await import('fflate');
  const docx=Buffer.from(zipSync({'word/document.xml':strToU8('<w:document xmlns:w="example"><w:body><w:p><w:r><w:t>订单 &amp; 退款</w:t></w:r></w:p><w:p><w:r><w:t>下一段</w:t></w:r></w:p></w:body></w:document>')}));
  assert.equal(await extractText('test.docx',docx),'订单 & 退款\n下一段\n');
  const content='BT /F1 12 Tf 50 100 Td (Business rules) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  assert.match(await extractText('test.pdf',Buffer.from(pdf)),/Business rules/);
});
test('SVN XML preserves mixed revisions and excludes externals and untracked entries',()=>{
  const info='<info><entry revision="120"><url>svn://host/repo</url><repository><uuid>uuid-1</uuid></repository></entry></info>';
  const status='<status><target path="."><entry path="a.ts"><wc-status item="modified" props="none" revision="119"/></entry><entry path="b.ts"><wc-status item="normal" props="none" revision="120"/></entry><entry path="temp.ts"><wc-status item="unversioned" props="none"/></entry><entry path="lib"><wc-status item="external" props="none"/></entry></target></status>';
  const parsed=parseSvn(info,status);assert.equal(parsed.dirty,true);assert.equal(parsed.revision,'r120');assert.deepEqual(parsed.entries,[{path:'a.ts',revision:'119'},{path:'b.ts',revision:'120'}]);
});
test('context packs cover all source lines without silently truncating',()=>{
  const files=[{id:'a',path:'file.ts',hash:'sha',revision:'r1',text:Array.from({length:100},(_,i)=>`line ${i}: ${'a'.repeat(40)}`).join('\n')}];
  const chunks=makeChunks(files,2200);assert.ok(chunks.length>1);
  const parts=chunks.flat();assert.equal(parts[0].start,1);assert.equal(parts.at(-1).end,100);
  for(let i=1;i<parts.length;i++)assert.equal(parts[i].start,parts[i-1].end+1);
  for(const chunk of chunks)assert.ok(chunk.reduce((n,p)=>n+p.text.length+300,0)<=2200);
  assert.throws(()=>makeChunks([{...files[0],text:'x'.repeat(3000)}],2200),/行过长/);
});
test('model output cannot invent citations or approve itself',()=>{
  const parts=[{fileId:'known',path:'a.ts',start:10,end:20,hash:'sha',revision:'r2'}];
  const content=JSON.stringify({articles:[{title:'规则',body:'正文',status:'reviewed',sources:[{fileId:'known',start:11,end:14},{fileId:'made-up',start:1,end:2},{fileId:'known',start:1,end:2}],questions:['需核对']}]});
  const result=parseAnalysis(content,parts);assert.equal(result[0].sources.length,1);assert.equal(result[0].status,'draft');
  assert.throws(()=>parseAnalysis(JSON.stringify({articles:[{title:'x',body:'x',sources:[{fileId:'made-up',start:1,end:2}]}]}),parts),/有效来源/);
});
test('model adapter validates endpoint and handles server failures without leaking response secrets',async()=>{
  assert.equal(normalizeEndpoint('https://example.com/v1/'),'https://example.com/v1/chat/completions');
  assert.throws(()=>normalizeEndpoint('http://remote.example/v1'),/HTTPS/);assert.throws(()=>normalizeEndpoint('https://user:secret@example.com/v1'),/账号/);
  let request;const out=await chat({baseUrl:'http://127.0.0.1:9999/v1',model:'test'},'secret',[{role:'user',content:'hi'}],{fetcher:async(url,options)=>{request=options;return response({choices:[{message:{content:'OK'}}]});}});
  assert.equal(out.content,'OK');assert.equal(request.redirect,'error');assert.equal(request.headers.Authorization,'Bearer secret');
  await assert.rejects(chat({baseUrl:'https://example.com/v1',model:'test'},'',[],{fetcher:async()=>new Response('private-server-output',{status:401})}),error=>error.message.includes('401')&&!error.message.includes('private'));
});
test('complete job persists drafts, exports evidence and marks changed source stale',async t=>{
  const root=await fixture(t),src=path.join(root,'repo');await fs.mkdir(src);await fs.writeFile(path.join(src,'a.ts'),'function cancel() { return true; }\n');
  const store=new Store(path.join(root,'state'));await store.load();const secrets=secretStore();
  const fetcher=async(url,options)=>{const payload=JSON.parse(options.body),material=JSON.parse(payload.messages[1].content),p=material.parts[0];return response({choices:[{message:{content:JSON.stringify({articles:[{title:'取消规则',domain:'订单',body:'## 条件\n允许取消。',sources:[{fileId:p.fileId,start:p.start,end:p.end}],questions:['调用方权限待确认']}]})}}]});};
  const service=new Service(store,secrets,{fetcher});const id=await service.createProject({name:'订单'});await service.addSources(id,[{root:src,name:'源码'}]);await service.scan(id);
  await service.saveModel({baseUrl:'http://127.0.0.1:9999/v1',model:'test',key:'dont-persist-me'});
  const p=service.project(id);await service.startAnalysis(id,{fileIds:p.index.files.map(f=>f.id),topic:'取消订单'});
  for(let i=0;i<100&&service.running.has(id);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(p.jobs[0].status,'completed');assert.equal(p.articles.length,1);assert.equal(p.articles[0].status,'draft');
  const a=p.articles[0];assert.match(articleMarkdown(a,p),/SHA256/);await service.updateArticle(id,a.id,{status:'reviewed'});assert.equal(a.status,'reviewed');
  await service.updateArticle(id,a.id,{body:'新的内容'});assert.equal(a.status,'draft');assert.equal(a.history.length,2);
  await fs.writeFile(path.join(src,'a.ts'),'changed');await service.scan(id);assert.equal(a.stale,true);await assert.rejects(service.updateArticle(id,a.id,{status:'reviewed'}),/来源已变化/);
  const persisted=await fs.readFile(path.join(root,'state/workspace.json'),'utf8');assert.ok(!persisted.includes('dont-persist-me'));const reloaded=new Store(path.join(root,'state'));await reloaded.load();assert.equal(reloaded.state.projects[0].articles.length,1);
  await service.saveModel({baseUrl:'http://127.0.0.1:9998/v1',model:'other'});assert.equal(await secrets.has('model'),false);
});
test('cancelling a running model request is persisted and produces no fake articles',async t=>{
  const root=await fixture(t);const src=path.join(root,'repo');await fs.mkdir(src);await fs.writeFile(path.join(src,'a.txt'),'业务说明');
  const store=new Store(path.join(root,'state'));await store.load();const fetcher=async(url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
  const service=new Service(store,secretStore(),{fetcher});const id=await service.createProject({name:'cancel'});await service.addSources(id,[{root:src}]);await service.scan(id);await service.saveModel({baseUrl:'http://localhost:99/v1',model:'test'});
  await service.startAnalysis(id,{fileIds:service.project(id).index.files.map(f=>f.id)});await new Promise(r=>setTimeout(r,20));await service.cancelAnalysis(id);
  for(let i=0;i<100&&service.running.has(id);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(service.project(id).jobs[0].status,'cancelled');assert.equal(service.project(id).articles.length,0);
});
test('Feishu creates documents in batches and exposes partial failures',async()=>{
  const calls=[];const fetcher=async(url,options)=>{calls.push([url,JSON.parse(options.body)]);if(url.includes('tenant_access'))return response({code:0,tenant_access_token:'token'});if(url.endsWith('/documents'))return response({code:0,data:{document:{document_id:'doc123'}}});return response({code:0,data:{}});};
  const result=await publishFeishu({appId:'app',folderToken:'folder'},'secret','title',Array(85).fill('paragraph').join('\n'),{fetcher});assert.match(result.url,/doc123$/);assert.equal(calls.length,5);assert.equal(calls[1][1].folder_token,'folder');
  await assert.rejects(publishFeishu({appId:'app'},'secret','title','body',{fetcher:async(url,options)=>url.includes('/children')?response({code:999}):fetcher(url,options)}),error=>error.partial?.id==='doc123');
});
