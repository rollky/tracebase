import fs from 'node:fs/promises';
import path from 'node:path';
export const initialState=()=>({schema:1,projects:[],models:{provider:'custom',baseUrl:'',model:''},feishu:{appId:'',folderToken:''},activeProjectId:null});
export class Store {
  constructor(directory){this.directory=directory;this.state=initialState();this.queue=Promise.resolve();}
  async load(){await fs.mkdir(this.directory,{recursive:true});try{this.state=JSON.parse(await fs.readFile(path.join(this.directory,'workspace.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('项目数据读取失败；已保留原文件，请先备份后排查。');}
    for(const p of this.state.projects)for(const j of p.jobs||[])if(['running','queued'].includes(j.status)){j.status='interrupted';j.message='应用关闭中断了任务，可重新发起分析';}
    for(const p of this.state.projects)for(const item of p.publications||[])if(item.status==='publishing'){item.status=item.url?'partial':'interrupted';item.message='应用关闭中断了发布，请先检查飞书中的文档，避免重复创建。';}
    return this.state;
  }
  save(){const text=JSON.stringify(this.state,null,2);this.queue=this.queue.catch(()=>{}).then(async()=>{const target=path.join(this.directory,'workspace.json');await fs.writeFile(target+'.tmp',text,{mode:0o600});await fs.rename(target+'.tmp',target);});return this.queue;}
}
export function articleMarkdown(article,project) {
  return `# ${article.title}\n\n> 项目：${project.name} · 状态：${article.status==='reviewed'?'人工已核对':'待审核草稿'}${article.stale?' · 来源已变化':''}${article.replacesArticleId?' · 更新建议（尚未应用）':''}\n> 生成于：${article.createdAt}\n\n${article.body}\n\n## 代码与文档依据\n\n${article.sources.map(s=>`- ${s.path}：${s.start}–${s.end} 行；版本 ${s.revision}；SHA256 ${s.hash}`).join('\n')}\n\n## 待确认问题\n\n${article.questions.length?article.questions.map(q=>'- '+q).join('\n'):'暂无记录。'}\n`;
}
