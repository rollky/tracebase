import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'tracebase-desktop-'));
const model=http.createServer(async(req,res)=>{
  let body='';for await(const data of req)body+=data;
  const request=JSON.parse(body);
  if(request.messages.length===1){res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));return;}
  const material=JSON.parse(request.messages[1].content),part=material.parts[0];
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({articles:[{title:'测试生成的取消规则',domain:'订单管理',summary:'真实桌面链路，模型响应由本机测试服务提供',body:'## 取消条件\n只有订单所有者可以取消订单。\n\n## 例外\n已发货订单应进入售后流程。',sources:[{fileId:part.fileId,start:part.start,end:part.end}],questions:['退款重试策略需要确认']} ]})}}]}));
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));let app;
try{
  const env={...process.env,NODE_ENV:'test',TRACEBASE_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:['.'],env,timeout:60000});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'创建第一个项目'}).waitFor();
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');assert.equal(await page.evaluate(()=>window.tracebase.desktop),true);
  await page.getByRole('button',{name:'创建第一个项目'}).click();await page.getByLabel('项目名称',{exact:true}).fill('桌面验证项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();
  const repo=path.resolve('fixtures/order-center');await app.evaluate(({dialog},repo)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[repo]});},repo);
  await page.getByRole('button',{name:'添加目录',exact:true}).click();await page.getByRole('button',{name:'开始扫描',exact:true}).click();await page.getByText('2 个文件已建立索引',{exact:true}).waitFor();
  await page.getByRole('button',{name:'模型与 API Key',exact:true}).click();await page.getByLabel('API 地址').fill(`http://127.0.0.1:${model.address().port}/v1`);await page.getByLabel('模型名称',{exact:true}).fill('test-model');await page.getByRole('button',{name:'保存配置',exact:true}).click();await page.getByRole('status').filter({hasText:'模型配置已保存'}).waitFor();await page.keyboard.press('Escape');
  await page.getByLabel('全选筛选结果').check();await page.getByRole('button',{name:'分析所选资料'}).click();await page.getByRole('button',{name:'开始分析',exact:true}).click();await page.getByText('分析完成，1 条草稿等待审核',{exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'知识库',exact:true}).click();await page.getByRole('heading',{name:'测试生成的取消规则',exact:true}).waitFor();
  await page.getByRole('button',{name:'标记已核对'}).click();await page.getByText('人工已核对',{exact:true}).waitFor();
  await page.locator('.source-card').first().click();await page.getByRole('dialog').waitFor();assert.ok(await page.locator('.code-view').textContent());await page.keyboard.press('Escape');
  const exportPath=path.join(profile,'export.md');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},exportPath);
  await page.getByRole('button',{name:'发布知识库',exact:true}).click();await page.getByRole('button',{name:'导出 Markdown'}).click();await page.getByRole('status').filter({hasText:'Markdown 已导出'}).waitFor();assert.match(await fs.readFile(exportPath,'utf8'),/SHA256/);
  await page.reload();await page.getByRole('heading',{name:'测试生成的取消规则',exact:true}).waitFor();
  await page.screenshot({path:'../tracebase-desktop.png'});
  assert.deepEqual(errors,[]);console.log('Desktop passed: isolated IPC, native selection, real filesystem scan, local mock model request, job completion, citation view, manual review, native export, reload persistence.');
}finally{await app?.close();await new Promise(r=>model.close(r));await fs.rm(profile,{recursive:true,force:true});}
