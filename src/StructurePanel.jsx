import React,{useState} from 'react';
export default function StructurePanel({project,onAnalyze}){
  const [query,setQuery]=useState('');
  const index=project.index,files=index?.files||[],graph=index?.graph;
  const names=new Map(files.map(f=>[f.id,f.path]));
  const parsed=files.filter(f=>f.structure?.parser==='typescript-ast');
  return <section className="structure-panel"><div className="section-heading"><h2>代码结构与依赖</h2><span>{parsed.length} 个 AST 文件 · {graph?.edges.length||0} 条本地导入关系</span></div>
    <div className="notice">JS / TS 使用语法树提取；调用点、候选路由与 SQL 表名可查看原始位置。本地导入关系不等于运行时调用链。其他语言目前仅提供文本分析。</div>
    {!graph?<p className="inline-empty">重新扫描资料，以建立结构索引。</p>:<><input className="structure-search" aria-label="搜索代码结构" placeholder="搜索文件、函数、路由或表名" value={query} onChange={e=>setQuery(e.target.value)}/>
    {files.filter(f=>f.structure?.parser==='typescript-ast'&&(f.path+JSON.stringify(f.structure)).toLowerCase().includes(query.toLowerCase())).slice(0,100).map(f=><details className="structure-file" key={f.id}><summary>{f.path}<small>{f.structure.symbols.length} 个符号 · {f.structure.calls.length} 个调用点</small></summary><button className="button small" onClick={()=>onAnalyze([f.id])}>分析此文件与依赖</button>
      {f.structure.warnings.map((w,i)=><p className="notice" key={i}>{w}</p>)}
      <div className="structure-columns"><div><h4>符号</h4>{f.structure.symbols.slice(0,60).map((s,i)=><p key={i}>{s.name} <small>L{s.start}–{s.end}</small></p>)}<h4>调用点</h4>{f.structure.calls.slice(0,60).map((s,i)=><p key={i}>{s.name} <small>L{s.line}</small></p>)}</div><div><h4>本地依赖</h4>{graph.edges.filter(e=>e.from===f.id).map((e,i)=><p key={i}>{names.get(e.to)} <small>L{e.line}</small></p>)}<h4>候选路由 / 数据表</h4>{[...f.structure.routes,...f.structure.tables].map((s,i)=><p key={i}>{s.method} {s.path||s.name} <small>L{s.line} · {s.certainty}</small></p>)}</div></div>
      {graph.unresolved.filter(e=>e.from===f.id).map((e,i)=><p className="muted" key={i}>{e.specifier} — {e.reason}</p>)}
      <small>每类最多展示 60 个符号或调用点；请结合源码核对。</small>
    </details>)}<p className="muted">最多显示 100 个文件，可搜索缩小范围。{graph.unresolved.length} 条导入关系未解析。</p></>}
  </section>;
}
