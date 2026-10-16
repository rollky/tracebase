import React from 'react';
function inline(text){return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:part);}
export default function Markdown({text=''}){
  const lines=text.split('\n'),blocks=[];let i=0;
  while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
    if(line.startsWith('```')){const rows=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))rows.push(lines[i++]);i++;blocks.push(<pre key={i}><code>{rows.join('\n')}</code></pre>);continue;}
    if(line.startsWith('|')&&lines[i+1]?.match(/^\|[\s:|\-]+\|?$/)){const cells=s=>s.split('|').slice(1,-1).map(s=>s.trim());const heads=cells(line),rows=[];i+=2;while(lines[i]?.startsWith('|'))rows.push(cells(lines[i++]));blocks.push(<div className="table-scroll" key={i}><table><thead><tr>{heads.map((h,n)=><th key={n}>{inline(h)}</th>)}</tr></thead><tbody>{rows.map((r,n)=><tr key={n}>{r.map((c,j)=><td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);continue;}
    if(/^#{1,4} /.test(line)){const level=line.match(/^#+/)[0].length;blocks.push(React.createElement('h'+Math.min(level+1,4),{key:i},inline(line.replace(/^#+ /,''))));}
    else if(line.startsWith('> '))blocks.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>);
    else if(/^(\d+\. |[-*] )/.test(line)){const ordered=/^\d/.test(line),rows=[];while(i<lines.length&&/^(\d+\. |[-*] )/.test(lines[i]))rows.push(lines[i++].replace(/^(\d+\. |[-*] )/,''));blocks.push(React.createElement(ordered?'ol':'ul',{key:i},rows.map((r,n)=><li key={n}>{inline(r)}</li>)));continue;}
    else blocks.push(<p key={i}>{inline(line)}</p>);i++;
  }
  return <div className="markdown">{blocks}</div>;
}
