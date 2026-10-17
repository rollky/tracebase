import {demoState} from './demo';
import {retrieve,normalizeScope} from '../core/retrieval.mjs';
const native=window.tracebase;
let state;
try{state=JSON.parse(localStorage.getItem('tracebase-preview-v1'))||demoState();}catch{state=demoState();}
const listeners=new Set();
const save=()=>{localStorage.setItem('tracebase-preview-v1',JSON.stringify(state));listeners.forEach(cb=>cb());};
const clone=x=>structuredClone(x);
const notDesktop=()=>{throw new Error('此功能需要桌面版。浏览器预览不会读取本地目录、存储密钥或调用模型。');};
async function preview(action,...args){
  if(action==='state')return clone(state);
  if(action==='previewQuestion'){const project=state.projects.find(p=>p.id===args[0]);return {candidates:retrieve(project.articles,args[1],args[2]),scope:normalizeScope(args[2]),fingerprint:'preview'};}
  if(action==='createProject'){const p={id:crypto.randomUUID(),name:args[0].name,description:args[0].description,createdAt:new Date().toISOString(),sources:[],articles:[],jobs:[],publications:[],index:null};if(!p.name.trim())throw new Error('请输入项目名称');state.projects.push(p);state.activeProjectId=p.id;save();return p.id;}
  if(action==='selectProject'){state.activeProjectId=args[0];save();return;}
  if(action==='importExample'){const example=demoState().projects[0];example.id=crypto.randomUUID();state.projects.push(example);state.activeProjectId=example.id;save();return example.id;}
  const p=state.projects.find(p=>p.id===args[0]);
  if(action==='updateArticle'){const a=p.articles.find(a=>a.id===args[1]);a.history??=[];a.history.unshift({at:new Date().toISOString(),body:a.body,status:a.status});Object.assign(a,args[2]);save();return;}
  if(action==='readSource'){const f=p.index.files.find(f=>f.id===args[1]);return {...f,text:'// 界面演示代码，不是实际项目来源\nexport function cancelOrder(order, owner) {\n  if (!owner) throw new Error("无权取消");\n  if (order.status === "shipped") {\n    return { action: "after_sales" };\n  }\n  if (order.status === "paid") {\n    return { action: "request_refund" };\n  }\n  return { action: "close_order" };\n}\n// 其它依赖尚未实现'};}
  if(action==='exportMarkdown'){
    const articles=args[1]?p.articles.filter(a=>a.id===args[1]):p.articles;
    if(!articles.length)throw new Error('暂无知识可以导出');
    const text=articles.map(a=>`# ${a.title}\n\n> 浏览器预览导出 · 示例内容\n\n${a.body}\n\n## 来源\n${a.sources.map(s=>`- ${s.path}:${s.start}–${s.end}（示例）`).join('\n')}`).join('\n\n---\n\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${p.name}-业务知识库.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return '已下载 Markdown';
  }
  return notDesktop();
}
export const api={desktop:!!native,call:(...args)=>native?native.call(...args):preview(...args),onChange:callback=>{if(native)return native.onChange(callback);listeners.add(callback);return()=>listeners.delete(callback);}};
