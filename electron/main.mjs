import {app,BrowserWindow,ipcMain,dialog,safeStorage,shell,Menu} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store,articleMarkdown} from '../core/storage.mjs';
import {Service} from '../core/service.mjs';
import {usageCsv,ensureBilling} from '../core/billing.mjs';
import {checkUpdates} from '../core/updates.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
let win,service;
app.setName('Tracebase');
// Test profiles are isolated from the user's real workspace and credentials.
if(process.env.TRACEBASE_TEST_USER_DATA&&process.env.NODE_ENV==='test')app.setPath('userData',path.resolve(process.env.TRACEBASE_TEST_USER_DATA));
const locked=app.requestSingleInstanceLock();if(!locked)app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
class Secrets{
  constructor(dir){this.file=path.join(dir,'secrets.json');this.data={};}
  async load(){try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  async has(key){return !!this.data[key];}
  async get(key){if(!this.data[key])return '';const data=Buffer.from(this.data[key],'base64');return safeStorage.decryptStringAsync?(await safeStorage.decryptStringAsync(data)).result:safeStorage.decryptString(data);}
  async set(key,value){const available=safeStorage.isAsyncEncryptionAvailable?await safeStorage.isAsyncEncryptionAvailable():safeStorage.isEncryptionAvailable();if(!available||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend?.()==='basic_text'))throw new Error('系统安全存储不可用，无法保存密钥');const encrypted=safeStorage.encryptStringAsync?await safeStorage.encryptStringAsync(value):safeStorage.encryptString(value);this.data[key]=encrypted.toString('base64');await this.persist();}
  async delete(key){delete this.data[key];await this.persist();}
  async persist(){await fs.writeFile(this.file+'.tmp',JSON.stringify(this.data),{mode:0o600});await fs.rename(this.file+'.tmp',this.file);}
}
const appURL=pathToFileURL(path.join(here,'../dist/index.html')).href;
function createWindow(){win=new BrowserWindow({width:1536,height:980,minWidth:1000,minHeight:700,backgroundColor:'#101820',title:'Tracebase',webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(url!==appURL)event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(false));win.loadURL(appURL);win.on('closed',()=>{win=null;});}
async function actions(action,args){
  if(action==='exportUsage'){
    const text=usageCsv(ensureBilling(service.store.state)),result=await dialog.showSaveDialog(win,{title:'导出用量月报',defaultPath:'tracebase-usage.csv',filters:[{name:'CSV',extensions:['csv']}]});
    if(result.canceled)return null;await fs.writeFile(result.filePath,text,{mode:0o600});return result.filePath;
  }
  if(action==='checkUpdates')return checkUpdates(app.getVersion());
  if(action==='backupProject'){
    const p=service.project(args[0]),text=service.backupProject(p.id);
    const result=await dialog.showSaveDialog(win,{title:'备份项目知识（不包含密钥和源码）',defaultPath:`${p.name}-backup.json`,filters:[{name:'Tracebase 项目备份',extensions:['json']}]});
    if(result.canceled)return null;await fs.writeFile(result.filePath,text,{mode:0o600});return result.filePath;
  }
  if(action==='restoreBackup'){
    const result=await dialog.showOpenDialog(win,{title:'恢复为独立项目副本，源码目录需重新关联',properties:['openFile'],filters:[{name:'Tracebase 项目备份',extensions:['json']}]});
    if(result.canceled)return null;const file=result.filePaths[0];if((await fs.stat(file)).size>20*1024*1024)throw new Error('备份超过 20 MB');return service.restoreProject(await fs.readFile(file,'utf8'));
  }
  if(action==='chooseSources'){
    const [id,kind]=args;service.project(id);
    const result=await dialog.showOpenDialog(win,{title:kind==='folder'?'选择代码或资料目录':'选择参考文档',properties:kind==='folder'?['openDirectory']:['openFile','multiSelections'],...(kind==='folder'?{}:{filters:[{name:'文档',extensions:['md','txt','pdf','docx','csv','json','html']} ]})});
    if(result.canceled)return false;
    const sources=kind==='folder'?[{root:result.filePaths[0],name:path.basename(result.filePaths[0]),kind:'folder'}]:result.filePaths.map(p=>({root:path.dirname(p),paths:[path.basename(p)],name:path.basename(p),kind:'document'}));
    await service.addSources(id,sources);return true;
  }
  if(action==='exportMarkdown'){
    const [id,articleId]=args,p=service.project(id),articles=articleId?p.articles.filter(a=>a.id===articleId):p.articles;
    if(!articles.length)throw new Error('没有可导出的知识条目');
    const result=await dialog.showSaveDialog(win,{defaultPath:`${p.name}-业务知识库.md`,filters:[{name:'Markdown',extensions:['md']}]});if(result.canceled)return null;
    await fs.writeFile(result.filePath,articles.map(a=>articleMarkdown(a,p)).join('\n\n---\n\n'),'utf8');return result.filePath;
  }
  if(action==='importExample'){
    const id=await service.createProject({name:'示例 · 订单中心',description:'本地示例源码，可用于体验扫描；AI 分析需配置模型。'});
    await service.addSources(id,[{root:path.resolve(here,'../fixtures/order-center'),name:'order-center',kind:'folder'}]);await service.scan(id);return id;
  }
  if(action==='openLink'){
    const value=args[0];if(typeof value!=='string'||!(/^https:\/\/www\.feishu\.cn\/docx\/[A-Za-z0-9_-]+$/.test(value)||/^https:\/\/github\.com\/rollky\/tracebase\/releases\/tag\/v\d+\.\d+\.\d+$/.test(value)))throw new Error('仅允许打开已发布的飞书文档或官方版本页');await shell.openExternal(value);return;
  }
  const allowed=['state','createProject','selectProject','removeSource','scan','saveModelRate','saveBudget','reconcileBudget','saveRuntime','saveSchedule','previewFeishu','importFeishu','refreshFeishu','previewPublication','appendPublication','saveModel','testModel','saveFeishu','testFeishu','previewAnalysis','inspectQuality','dismissQuality','consolidateKnowledge','previewQuestion','answerQuestion','startAnalysis','cancelAnalysis','resumeAnalysis','readSource','updateArticle','applyUpdate','publish'];
  if(!allowed.includes(action))throw new Error('不支持的操作');
  return service[action](...args);
}
if(locked)app.whenReady().then(async()=>{
  const dir=app.getPath('userData');const store=new Store(dir);await store.load();const secrets=new Secrets(dir);await secrets.load();
  service=new Service(store,secrets,{notify:()=>win?.webContents.send('tracebase:changed')});
  const scheduler=setInterval(()=>service.scanDueProjects().catch(()=>{}),60000);scheduler.unref();app.on('before-quit',()=>clearInterval(scheduler));
  ipcMain.handle('tracebase:action',async(event,action,args)=>{
    if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==appURL)return {error:'非法调用来源'};
    try{if(!Array.isArray(args))throw new Error('无效参数');return {value:await actions(action,args)};}catch(error){return {error:error.message};}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform==='darwin'?[{role:'appMenu'}]:[]),{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));createWindow();
  app.on('activate',()=>{if(!win)createWindow();});
}).catch(error=>{dialog.showErrorBox('Tracebase 启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{for(const c of service?.running.values()||[])c.abort();});
