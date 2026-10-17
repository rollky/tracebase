export function retrieve(articles,question){
  if(typeof question!=='string'||!question.trim()||question.length>1000)throw new Error('请输入 1–1000 字的问题');
  const normalized=question.toLowerCase();
  const tokens=new Set(normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]{2}/g)||[]);
  for(const segment of normalized.match(/[\u3400-\u9fff]+/g)||[])for(let i=0;i<segment.length-1;i++)tokens.add(segment.slice(i,i+2));
  if(!tokens.size)tokens.add(normalized.trim());
  return articles.filter(a=>!a.stale&&!a.replacesArticleId).map(a=>{
    const title=(a.title+' '+a.domain).toLowerCase(),body=a.body.toLowerCase();
    const score=[...tokens].reduce((sum,t)=>sum+(title.includes(t)?5:0)+(body.includes(t)?1:0),0);
    const matches=[...tokens].map(t=>body.indexOf(t)).filter(i=>i>=0),start=Math.max(0,(matches.length?Math.min(...matches):0)-300);
    return {id:a.id,title:a.title,status:a.status,score,excerpt:a.body.slice(start,start+3500),truncated:start>0||a.body.length>3500,sources:a.sources};
  }).filter(a=>a.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}

export function parseAnswer(content,candidates){
  let data;try{data=JSON.parse(content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('模型未返回可校验的问答结果，请重试');}
  if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('模型未返回回答');
  const ids=new Set(candidates.map(c=>c.id));
  const references=Array.isArray(data.references)?[...new Set(data.references)].filter(id=>ids.has(id)):[];
  if(!references.length)throw new Error('回答缺少有效知识引用，未保存。请补充相关知识或调整问题。');
  return {answer:data.answer.slice(0,30000),references};
}
