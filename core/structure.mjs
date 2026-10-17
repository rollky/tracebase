import ts from 'typescript';
import path from 'node:path';

// Parse source only. Never load project configuration or execute project code.
export function extractStructure(file, text) {
  const result={parser:'text',symbols:[],imports:[],calls:[],routes:[],tables:[],warnings:[]};
  if(!/\.(?:[cm]?[jt]sx?)$/i.test(file))return result;
  result.parser='typescript-ast';
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const line=node=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  const literal=node=>node&&(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))?node.text:null;
  const add=(list,item)=>{if(list.length<2000)list.push(item);else if(!result.warnings.includes('结构条目超过上限，结果不完整'))result.warnings.push('结构条目超过上限，结果不完整');};
  function visit(node){
    if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isMethodDeclaration(node)||ts.isEnumDeclaration(node))&&node.name)
      add(result.symbols,{name:node.name.getText(source),kind:ts.SyntaxKind[node.kind],start:line(node),end:source.getLineAndCharacterOfPosition(node.end).line+1});
    if(ts.isVariableDeclaration(node)&&node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))add(result.symbols,{name:node.name.getText(source),kind:'Function',start:line(node),end:source.getLineAndCharacterOfPosition(node.end).line+1});
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&literal(node.moduleSpecifier)!==null)add(result.imports,{specifier:literal(node.moduleSpecifier),line:line(node)});
    if(ts.isCallExpression(node)){
      const name=node.expression.getText(source);
      add(result.calls,{name:name.slice(0,200),line:line(node)});
      if((name==='require'||node.expression.kind===ts.SyntaxKind.ImportKeyword)&&literal(node.arguments[0])!==null)add(result.imports,{specifier:literal(node.arguments[0]),line:line(node)});
      const method=name.match(/\.(get|post|put|patch|delete|all|use)$/)?.[1];
      if(method&&literal(node.arguments[0])?.startsWith('/'))add(result.routes,{method:method.toUpperCase(),path:literal(node.arguments[0]),line:line(node),certainty:'候选路由，需核对框架'});
    }
    const value=literal(node);
    if(value&&/\b(select|insert|update|delete|create\s+table)\b/i.test(value))for(const match of value.matchAll(/\b(?:from|join|into|update|table)\s+([\w.]+)/gi))add(result.tables,{name:match[1],line:line(node),certainty:'SQL 字符串候选'});
    ts.forEachChild(node,visit);
  }
  try{visit(source);}catch{result.warnings.push('语法遍历未完成');}
  if(source.parseDiagnostics.length)result.warnings.push('存在语法错误，结构索引可能不完整');
  return result;
}

export function buildGraph(files){
  const lookup=new Map(files.map(f=>[`${f.sourceId}:${f.path}`,f.id]));
  const edges=[],unresolved=[];
  for(const file of files)for(const item of file.structure?.imports||[]){
    if(!item.specifier.startsWith('.')){unresolved.push({from:file.id,...item,reason:'外部依赖或路径别名，未解析'});continue;}
    const base=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),item.specifier));
    const roots=[base];if(/\.[cm]?js$/.test(base))roots.push(base.replace(/\.([cm]?)js$/,'.$1ts'));
    const candidates=[...new Set(roots.flatMap(r=>[r,...['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts','/index.ts','/index.tsx','/index.js'].map(ext=>r+ext)]))];
    const matches=candidates.map(p=>lookup.get(`${file.sourceId}:${p}`)).filter(Boolean);
    if(matches.length===1)edges.push({from:file.id,to:matches[0],line:item.line,kind:'import',specifier:item.specifier});
    else unresolved.push({from:file.id,...item,reason:matches.length?'多个候选，未自动选择':'未找到本地依赖'});
  }
  return {edges,unresolved};
}

export function expandContext(index,selected,{depth=2,limit=80}={}){
  const known=new Set(index.files.map(f=>f.id)),ids=new Set(selected),added=[],omitted=new Set();
  if([...ids].some(id=>!known.has(id)))throw new Error('所选资料已不在索引中，请重新选择');
  const outgoing=new Map();for(const e of index.graph?.edges||[]){if(!outgoing.has(e.from))outgoing.set(e.from,[]);outgoing.get(e.from).push(e);}
  let frontier=[...ids];
  for(let i=0;i<depth;i++){const next=[];for(const from of frontier)for(const edge of outgoing.get(from)||[]){if(ids.has(edge.to))continue;if(ids.size>=limit){omitted.add(edge.to);continue;}ids.add(edge.to);next.push(edge.to);added.push({id:edge.to,from,reason:`第 ${i+1} 层本地导入`});}frontier=next;}
  for(const from of ids)for(const e of outgoing.get(from)||[])if(!ids.has(e.to))omitted.add(e.to);
  return {ids:[...ids],added,omitted:[...omitted]};
}

export function impactedFiles(before,after,changed){
  const affected=new Set(changed),reverse=new Map();
  for(const e of [...(before?.graph?.edges||[]),...(after?.graph?.edges||[])]){if(!reverse.has(e.to))reverse.set(e.to,new Set());reverse.get(e.to).add(e.from);}
  const queue=[...affected];for(let i=0;i<queue.length;i++)for(const id of reverse.get(queue[i])||[])if(!affected.has(id)){affected.add(id);queue.push(id);}
  return affected;
}
