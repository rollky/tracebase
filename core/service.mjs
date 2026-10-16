import {randomUUID} from 'node:crypto';
import {scanSources,compareIndex,readEvidence,makeChunks} from './scanner.mjs';
import {chat,parseAnalysis,SYSTEM_PROMPT,normalizeEndpoint} from './model.mjs';
import {articleMarkdown} from './storage.mjs';
import {feishuToken,publishFeishu} from './feishu.mjs';
const now=()=>new Date().toISOString();
export class Service {
  constructor(store,secrets,{notify=()=>{},fetcher=fetch}={}){this.store=store;this.secrets=secrets;this.notify=notify;this.fetcher=fetcher;this.running=new Map();this.scanning=new Set();}
  project(id){const p=this.store.state.projects.find(p=>p.id===id);if(!p)throw new Error('项目不存在');return p;}
  async state(){return {...structuredClone(this.store.state),models:{...this.store.state.models,hasKey:await this.secrets.has('model')},feishu:{...this.store.state.feishu,hasSecret:await this.secrets.has('feishu')}};}
  async save(){await this.store.save();this.notify();}
  async createProject({name,description=''}){if(!name?.trim())throw new Error('请输入项目名称');const p={id:randomUUID(),name:name.trim().slice(0,80),description:String(description).slice(0,500),createdAt:now(),sources:[],articles:[],jobs:[],publications:[],index:null,changes:null};this.store.state.projects.push(p);this.store.state.activeProjectId=p.id;await this.save();return p.id;}
  async selectProject(id){this.project(id);this.store.state.activeProjectId=id;await this.save();}
  async addSources(id,sources){const p=this.project(id);if(this.running.has(id)||this.scanning.has(id))throw new Error('请等待当前任务完成后修改资料来源');for(const s of sources)if(!p.sources.some(x=>x.root===s.root&&JSON.stringify(x.paths)===JSON.stringify(s.paths)))p.sources.push({...s,id:randomUUID()});await this.save();}
  async removeSource(id,sourceId){const p=this.project(id);if(this.running.has(id)||this.scanning.has(id))throw new Error('任务运行时不能移除资料');p.sources=p.sources.filter(s=>s.id!==sourceId);for(const a of p.articles)if(a.sources.some(s=>p.index?.files.some(f=>f.id===s.fileId&&f.sourceId===sourceId)))a.stale=true;p.index=null;await this.save();}
  async scan(id){const p=this.project(id);if(!p.sources.length)throw new Error('请先添加代码目录或文档');if(this.running.has(id)||this.scanning.has(id))throw new Error('当前项目已有任务运行');this.scanning.add(id);
    try{const index=await scanSources(p.sources);p.changes=compareIndex(p.index,index);const changed=new Set([...p.changes.modified,...p.changes.deleted]);for(const a of p.articles)if(a.sources.some(s=>changed.has(s.fileId)||index.files.find(f=>f.id===s.fileId)?.hash!==s.hash))a.stale=true;p.index=index;await this.save();return index.files.length;}finally{this.scanning.delete(id);}}
  async saveModel(input){if(this.running.size)throw new Error('请等待分析完成后修改模型');const baseUrl=normalizeEndpoint(input.baseUrl).replace(/\/chat\/completions$/,'');if(!input.model?.trim())throw new Error('请输入模型名称');
    const old=this.store.state.models;const changed=old.baseUrl!==baseUrl;
    if(input.key?.trim())await this.secrets.set('model',input.key.trim());else if(changed||input.clearKey)await this.secrets.delete('model');
    this.store.state.models={provider:input.provider||'custom',baseUrl,model:input.model.trim()};await this.save();}
  async testModel(){const c=this.store.state.models;await chat(c,await this.secrets.get('model'),[{role:'user',content:'Reply with OK.'}],{fetcher:this.fetcher,maxTokens:32});return '连接成功：模型已返回响应';}
  async saveFeishu(input){if(input.secret?.trim())await this.secrets.set('feishu',input.secret.trim());else if(this.store.state.feishu.appId!==input.appId||input.clearSecret)await this.secrets.delete('feishu');this.store.state.feishu={appId:String(input.appId||'').trim(),folderToken:String(input.folderToken||'').trim()};await this.save();}
  async testFeishu(){await feishuToken(this.store.state.feishu,await this.secrets.get('feishu'),this.fetcher);return '应用身份验证成功；发布时还会验证文档权限';}
  async previewAnalysis(id,fileIds){const p=this.project(id);if(!Array.isArray(fileIds)||!fileIds.length)throw new Error('请选择要分析的文件');if(fileIds.length>80)throw new Error('单次最多选择 80 个文件，请分业务模块分析');const evidence=[];for(const fid of new Set(fileIds))evidence.push(await readEvidence(p,fid));const chunks=makeChunks(evidence);if(chunks.length>30)throw new Error('本次内容超过 30 批，请缩小分析范围');return {files:evidence.map(({text,...f})=>f),chunks,batches:chunks.length,characters:chunks.flat().reduce((n,p)=>n+p.text.length,0)};}
  async startAnalysis(id,{fileIds,topic}){const p=this.project(id);if(this.running.has(id)||this.scanning.has(id))throw new Error('当前项目已有任务运行');if(!this.store.state.models.model)throw new Error('请先配置 AI 模型');const controller=new AbortController();this.running.set(id,controller);
    try{
      const pack=await this.previewAnalysis(id,fileIds);const config={...this.store.state.models},key=await this.secrets.get('model');
      const job={id:randomUUID(),topic:String(topic||'业务知识提取').slice(0,200),status:'running',createdAt:now(),total:pack.chunks.length,completed:0,message:'正在准备分析材料',fileIds:[...new Set(fileIds)],model:config.model,articleIds:[]};p.jobs.unshift(job);await this.save();
      this.runAnalysis(p,job,pack,config,key,controller).catch(()=>{});return job.id;
    }catch(error){this.running.delete(id);throw error;}}
  async runAnalysis(p,job,pack,config,key,controller){try{
    for(let i=0;i<pack.chunks.length;i++){
      controller.signal.throwIfAborted();job.message=`正在分析第 ${i+1} / ${pack.chunks.length} 批`;await this.save();
      const parts=pack.chunks[i];const result=await chat(config,key,[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:JSON.stringify({task:job.topic,scope:'这是局部资料，不代表全项目。未给出的依赖请标为待确认。',parts})}],{signal:controller.signal,fetcher:this.fetcher});
      controller.signal.throwIfAborted();const articles=parseAnalysis(result.content,parts);
      for(const article of articles){const a={...article,id:randomUUID(),createdAt:now(),model:config.model,jobId:job.id,stale:false,history:[]};p.articles.push(a);job.articleIds.push(a.id);}
      job.completed=i+1;job.message=`已完成 ${job.completed} 批，生成 ${job.articleIds.length} 条草稿`;await this.save();
    }job.status='completed';job.message=`分析完成，${job.articleIds.length} 条草稿等待审核`;
  }catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.message=controller.signal.aborted?'已停止，已完成的草稿已保留':error.message;}
    finally{job.finishedAt=now();this.running.delete(p.id);await this.save();}}
  async cancelAnalysis(id){this.running.get(id)?.abort();}
  async readSource(id,fileId){return readEvidence(this.project(id),fileId);}
  async updateArticle(id,articleId,patch){const p=this.project(id),a=p.articles.find(a=>a.id===articleId);if(!a)throw new Error('知识条目不存在');
    a.history??=[];a.history.unshift({at:now(),body:a.body,status:a.status});a.history=a.history.slice(0,20);
    if(typeof patch.body==='string'){if(patch.body.length>100000)throw new Error('内容超过 100,000 字符');a.body=patch.body;a.status='draft';}
    if(patch.status==='reviewed'){if(a.stale)throw new Error('来源已变化，请重新分析后再核对');a.status='reviewed';}
    if(patch.status==='draft')a.status='draft';a.updatedAt=now();await this.save();}
  async publish(id,articleId){const p=this.project(id),a=p.articles.find(a=>a.id===articleId);if(!a)throw new Error('知识条目不存在');if(a.stale)throw new Error('来源已变化，请先更新知识再发布');const publication={id:randomUUID(),title:a.title,at:now(),status:'publishing',target:'feishu',articleId};p.publications.unshift(publication);await this.save();
    try{const result=await publishFeishu(this.store.state.feishu,await this.secrets.get('feishu'),`${p.name} · ${a.title}`,articleMarkdown(a,p),{fetcher:this.fetcher,onCreated:async result=>{Object.assign(publication,result);await this.save();}});Object.assign(publication,result,{status:'published'});await this.save();return result;}
    catch(error){publication.status=publication.url?'partial':'failed';publication.message=error.message;await this.save();throw error;}}
}
