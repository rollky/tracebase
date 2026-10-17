const ORIGIN='https://open.feishu.cn/open-apis';
async function request(route,body,token,fetcher,method='POST') {
  const r=await fetcher(ORIGIN+route,{method,redirect:'error',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  if(!r.ok)throw new Error(`飞书请求失败（HTTP ${r.status}）`);
  const data=await r.json();if(data.code!==0)throw new Error(`飞书错误 ${data.code}：请检查应用权限、文件夹授权和应用发布状态`);return data;
}
export async function feishuToken(config,secret,fetcher=fetch) {
  if(!config.appId||!secret)throw new Error('请先配置飞书 App ID 和 App Secret');
  const data=await request('/auth/v3/tenant_access_token/internal',{app_id:config.appId,app_secret:secret},null,fetcher);
  if(!data.tenant_access_token)throw new Error('飞书未返回访问令牌');return data.tenant_access_token;
}
export async function publishFeishu(config,secret,title,markdown,{fetcher=fetch,onCreated=()=>{}}={}) {
  const token=await feishuToken(config,secret,fetcher);
  const created=await request('/docx/v1/documents',{title,...(config.folderToken?{folder_token:config.folderToken}:{})},token,fetcher);
  const id=created.data?.document?.document_id;
  if(!id)throw new Error('飞书未返回文档 ID');
  const result={id,url:`https://www.feishu.cn/docx/${id}`};await onCreated(result);
  // Preserve all content as paragraph text; rich Markdown conversion is a future adapter.
  const paragraphs=[];
  for(const line of markdown.split('\n'))for(let i=0;i<Math.max(line.length,1);i+=1500)paragraphs.push(line.slice(i,i+1500)||' ');
  try {
    for(let i=0;i<paragraphs.length;i+=40) {
      await request(`/docx/v1/documents/${encodeURIComponent(id)}/blocks/${encodeURIComponent(id)}/children`,{index:-1,children:paragraphs.slice(i,i+40).map(text=>({block_type:2,text:{elements:[{text_run:{content:text}}],style:{}}}))},token,fetcher);
    }
  }catch(error){const err=new Error(`${error.message}。已创建部分文档，请在发布记录中检查后再重试。`);err.partial=result;throw err;}
  return result;
}

export function parseFeishuLink(value){
  let url;try{url=new URL(value);}catch{throw new Error('请输入有效的飞书文档链接');}
  const match=url.pathname.match(/^\/(docx|wiki)\/([A-Za-z0-9_-]+)\/?$/);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='feishu.cn'||url.hostname.endsWith('.feishu.cn'))||!match)throw new Error('仅支持飞书 HTTPS docx / wiki 文档链接');
  return {kind:match[1],token:match[2],url:`https://${url.hostname}/${match[1]}/${match[2]}`};
}
const validId=id=>{if(typeof id!=='string'||!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('飞书文档标识无效');return id;};
async function metadata(id,token,fetcher){
  const result=await request(`/docx/v1/documents/${validId(id)}`,null,token,fetcher,'GET');const doc=result.data?.document;
  if(!doc||!Number.isSafeInteger(doc.revision_id)||doc.revision_id<0)throw new Error('无法确认飞书文档版本');return doc;
}
export async function readFeishu(config,secret,link,{fetcher=fetch}={}){
  const parsed=parseFeishuLink(link),token=await feishuToken(config,secret,fetcher);let id=parsed.token,wiki=null;
  if(parsed.kind==='wiki'){const result=await request(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(id)}`,null,token,fetcher,'GET');wiki=result.data?.node;if(wiki?.obj_type!=='docx')throw new Error('当前仅支持知识空间中的新版文档，不支持表格或旧版文档');id=validId(wiki.obj_token);}
  const before=await metadata(id,token,fetcher);
  const result=await request(`/docx/v1/documents/${validId(id)}/raw_content`,null,token,fetcher,'GET');const content=result.data?.content;
  if(typeof content!=='string'||!content.trim())throw new Error('飞书文档没有可读取的文本');if(Buffer.byteLength(content)>1024*1024)throw new Error('飞书正文超过 1 MB，请拆分导入');
  const after=await metadata(id,token,fetcher);if(before.revision_id!==after.revision_id)throw new Error('读取期间飞书文档发生修改，请重试');
  return {documentId:id,title:before.title||wiki?.title||'飞书文档',revision:before.revision_id,text:content,url:parsed.url,...(wiki?{wiki:{nodeToken:wiki.node_token,spaceId:wiki.space_id}}:{})};
}
export async function appendFeishu(config,secret,id,markdown,expectedRevision,{fetcher=fetch,onProgress=()=>{}}={}){
  validId(id);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('请先预览在线文档版本');
  const token=await feishuToken(config,secret,fetcher),doc=await metadata(id,token,fetcher);
  if(doc.revision_id!==expectedRevision)throw new Error('在线文档已变化，请重新预览后再更新');
  const paragraphs=[];for(const line of markdown.split('\n'))for(let i=0;i<Math.max(line.length,1);i+=1500)paragraphs.push(line.slice(i,i+1500)||' ');
  let revision=expectedRevision,written=0;
  try{for(let i=0;i<paragraphs.length;i+=40){
    const result=await request(`/docx/v1/documents/${id}/blocks/${id}/children?document_revision_id=${revision}`,{index:-1,children:paragraphs.slice(i,i+40).map(content=>({block_type:2,text:{elements:[{text_run:{content}}],style:{}}}))},token,fetcher);
    written+=paragraphs.slice(i,i+40).length;
    if(!Number.isSafeInteger(result.data?.document_revision_id))throw new Error('写入后未返回文档版本，请检查在线内容');
    revision=result.data.document_revision_id;await onProgress({written,revision});
  }}catch(error){error.partial={written,revision};throw error;}
  return {revision,written,url:`https://www.feishu.cn/docx/${id}`};
}
