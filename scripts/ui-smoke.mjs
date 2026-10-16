import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1536,height:960},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');await page.getByRole('heading',{name:'订单取消',exact:true}).waitFor();
  await page.screenshot({path:'../tracebase-preview.png',fullPage:true});
  await page.getByRole('button',{name:'业务地图',exact:true}).click();await page.getByRole('heading',{name:'业务地图',exact:true}).waitFor();
  await page.getByRole('button',{name:'待确认问题',exact:false}).first().click();await page.getByRole('heading',{name:'把不确定的地方，留在明处'}).waitFor();
  await page.getByRole('button',{name:'知识库',exact:true}).click();await page.getByRole('button',{name:'编辑内容'}).click();
  await page.getByLabel('编辑知识正文').fill('## 修改后的业务规则\n仅限本人取消。');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('heading',{name:'修改后的业务规则'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'修改后的业务规则'}).waitFor();
  await page.getByRole('button',{name:'模型与 API Key',exact:true}).click();await page.getByRole('dialog',{name:'模型与 API Key'}).waitFor();assert.equal(await page.locator('input[type=password]').count(),1);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('测试项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.getByRole('heading',{name:'从资料出发，理解业务'}).waitFor();
  await page.getByRole('button',{name:'添加目录',exact:true}).click();await page.getByRole('alert').filter({hasText:'桌面版'}).waitFor();
  await page.setViewportSize({width:1100,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('UI passed: navigation, edits, persistence, model modal, project creation, explicit preview limitations, responsive viewport.');
}finally{await browser.close();}
