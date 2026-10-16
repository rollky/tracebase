const ORIGIN='https://open.feishu.cn/open-apis';
async function request(route,body,token,fetcher) {
  const r=await fetcher(ORIGIN+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
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
