export function normalizeScope(scope={}){
  if(!scope||typeof scope!=='object'||Array.isArray(scope))throw new Error('无效的检索范围');
  const {domain='',status='all',limit=5}=scope;
  if(typeof domain!=='string'||domain.length>80||!['all','reviewed'].includes(status)||![3,5,8].includes(limit))throw new Error('无效的检索范围');
  return {domain,status,limit};
}
function passages(body){
  const result=[];let offset=0,line=1;
  while(offset<body.length){
    let end=Math.min(offset+1600,body.length);
    if(end<body.length){const boundary=body.lastIndexOf('\n',end-1);if(boundary>offset+400)end=boundary+1;}
    const excerpt=body.slice(offset,end),start=line;
    line+=(excerpt.match(/\n/g)||[]).length;
    result.push({excerpt,start,end:start+(excerpt.replace(/\n$/,'').match(/\n/g)||[]).length,offset,truncated:offset>0||end<body.length});offset=end;
  }
  return result;
}
export function retrieve(articles,question,scope={}){
  if(typeof question!=='string'||!question.trim()||question.length>1000)throw new Error('请输入 1–1000 字的问题');
  const options=normalizeScope(scope),normalized=question.toLowerCase();
  const tokens=new Set(normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]{2}/g)||[]);
  for(const segment of normalized.match(/[\u3400-\u9fff]+/g)||[])for(let i=0;i<segment.length-1;i++)tokens.add(segment.slice(i,i+2));
  if(!tokens.size)tokens.add(normalized.trim());
  const found=[];
  for(const a of articles){
    if(a.stale||a.replacesArticleId||(options.domain&&a.domain!==options.domain)||(options.status==='reviewed'&&a.status!=='reviewed'))continue;
    const title=(a.title+' '+a.domain).toLowerCase(),titleScore=[...tokens].reduce((sum,t)=>sum+(title.includes(t)?2:0),0);
    const ranked=passages(a.body).map(p=>({...p,score:titleScore+[...tokens].reduce((sum,t)=>sum+(p.excerpt.toLowerCase().includes(t)?3:0),0)})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.offset-b.offset).slice(0,2);
    for(const p of ranked)found.push({id:a.id,title:a.title,domain:a.domain,status:a.status,...p});
  }
  return found.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)||a.offset-b.offset).slice(0,options.limit).map((p,i)=>({...p,passageId:`K${i+1}`}));
}

export function parseAnswer(content,candidates){
  let data;try{data=JSON.parse(content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('模型未返回可校验的问答结果，请重试');}
  if(typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>30000)throw new Error('模型未返回有效回答');
  if(!Array.isArray(data.references)||!data.references.length||data.references.length>24)throw new Error('回答缺少有效知识引用，未保存');
  const references=[],seen=new Set();
  for(const r of data.references){
    const c=candidates.find(c=>c.passageId===r?.passageId);
    if(!c||typeof r.quote!=='string'||!r.quote.trim()||r.quote.length>1600)throw new Error('回答包含无效知识引用，未保存');
    const pos=c.excerpt.indexOf(r.quote);
    if(pos<0)throw new Error('引用原文与知识片段不一致，未保存');
    const start=c.start+(c.excerpt.slice(0,pos).match(/\n/g)||[]).length,end=start+(r.quote.match(/\n/g)||[]).length;
    const key=c.passageId+'\0'+r.quote;if(seen.has(key))continue;seen.add(key);
    references.push({id:c.id,passageId:c.passageId,quote:r.quote,start,end});
  }
  const markers=[...data.answer.matchAll(/\[(K\d+)\]/g)].map(m=>m[1]);
  if(!markers.length||markers.some(id=>!references.some(r=>r.passageId===id))||references.some(r=>!markers.includes(r.passageId)))throw new Error('回答正文与引用标记不一致，未保存');
  return {answer:data.answer,references};
}
