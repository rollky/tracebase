const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function grams(text){const compact=normalize(text).replace(/\s/g,'');const set=new Set();for(let i=0;i<compact.length-2;i++)set.add(compact.slice(i,i+3));return set;}
function similarity(a,b){if(!a.size||!b.size)return 0;let shared=0;for(const s of (a.size<b.size?a:b))if((a.size<b.size?b:a).has(s))shared++;return 2*shared/(a.size+b.size);}
export function inspectKnowledge(articles){
  const eligible=articles.filter(a=>!a.replacesArticleId),selected=eligible.slice(0,500),prepared=selected.map(a=>({a,text:normalize(a.body),grams:grams(a.body.slice(0,12000))}));
  const pairs=[];let compared=0,work=0,limited=eligible.length>500||selected.some(a=>a.body.length>12000);
  outer:for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++){
    if(compared++>=50000){limited=true;break outer;}
    const x=prepared[i],y=prepared[j],exact=x.text.length>0&&x.text===y.text;
    if(!exact){work+=Math.min(x.grams.size,y.grams.size);if(work>5000000){limited=true;break outer;}}
    const score=exact?1:similarity(x.grams,y.grams);
    if(!exact&&(score<0.72||x.a.domain!==y.a.domain))continue;
    const reasons=[exact?'标准化空白及大小写后正文相同':'同领域正文存在较多相同文字'];
    const numbers=text=>[...new Set(text.match(/\d+(?:\.\d+)?\s*(?:%|天|小时|分钟|元|次)?/g)||[])].sort().join('|');
    const negative=text=>/不允许|禁止|不得|不能|不可|无需|不需要|\b(?:not|never|forbidden)\b/.test(text);
    const review=!exact&&(numbers(x.text)!==numbers(y.text)||negative(x.text)!==negative(y.text));
    if(review)reasons.push('数字或否定措辞存在差异，请核对适用条件；不代表已确认冲突');
    pairs.push({left:x.a.id,right:y.a.id,kind:exact?'exact':'similar',score:Math.round(score*100),review,reasons});
  }
  pairs.sort((a,b)=>Number(b.review)-Number(a.review)||b.score-a.score);
  return {pairs:pairs.slice(0,100),totalPairs:pairs.length,examined:selected.length,eligible:eligible.length,compared:Math.min(compared,50000),limited:limited||pairs.length>100};
}
