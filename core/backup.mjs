import {randomUUID} from 'node:crypto';
const string=(v,max=2000000)=>{if(typeof v!=='string')return '';if(v.length>max)throw new Error('备份字段过长，无法安全恢复');return v;};
const list=(v,max=10000)=>{if(!Array.isArray(v))return [];if(v.length>max)throw new Error('备份条目超过上限');return v;};
function article(a){
  if(!a||typeof a!=='object'||!string(a.title)||!string(a.body))throw new Error('备份中的知识条目格式无效');
  return {id:string(a.id,100)||randomUUID(),title:string(a.title,160),...(a.replacesArticleId?{replacesArticleId:string(a.replacesArticleId,100),originalHash:string(a.originalHash,100)}:{}),domain:string(a.domain,80),summary:string(a.summary,1000),body:string(a.body),status:'draft',stale:true,staleReason:'从备份恢复，需重新关联资料并生成更新',createdAt:string(a.createdAt,100),model:string(a.model,100),questions:list(a.questions,100).map(q=>string(q,2000)),sources:list(a.sources,1000).map(s=>({fileId:string(s?.fileId,100),path:string(s?.path,1000),start:Number.isSafeInteger(s?.start)&&s.start>0?s.start:1,end:Number.isSafeInteger(s?.end)&&s.end>0?s.end:1,hash:string(s?.hash,100),revision:string(s?.revision,100)})),history:list(a.history,20).map(h=>({at:string(h?.at,100),body:string(h?.body),status:'draft'}))};
}
export function exportProject(project){
  return JSON.stringify({format:'tracebase-project',version:1,exportedAt:new Date().toISOString(),project:{name:project.name,description:project.description,articles:project.articles.map(a=>({...article(a),status:a.status,stale:!!a.stale})),sourceNames:project.sources.map(s=>s.name)}},null,2);
}
export function importProject(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>20*1024*1024)throw new Error('备份超过 20 MB');
  let data;try{data=JSON.parse(text);}catch{throw new Error('备份不是有效 JSON');}
  if(data?.format!=='tracebase-project'||data.version!==1||!data.project||!Array.isArray(data.project.articles)||data.project.articles.length>10000)throw new Error('不支持的项目备份格式');
  const articles=data.project.articles.map(article);if(new Set(articles.map(a=>a.id)).size!==articles.length)throw new Error('备份存在重复知识 ID');
  return {id:randomUUID(),name:(string(data.project.name,80).slice(0,70)||'恢复项目')+' · 恢复副本',description:string(data.project.description,500),createdAt:new Date().toISOString(),sources:[],articles,jobs:[],publications:[],answers:[],index:null,changes:null};
}
