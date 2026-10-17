import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {XMLParser} from 'fast-xml-parser';
import {extractStructure,buildGraph} from './structure.mjs';

const execute = promisify(execFile);
export const SKIP = new Set(['.git','.svn','node_modules','vendor','dist','build','target','.venv','venv','__pycache__','.next','coverage','release','.idea','.vscode']);
const EXT = new Set(['.py','.java','.kt','.go','.rs','.js','.mjs','.cjs','.mts','.cts','.jsx','.ts','.tsx','.vue','.cs','.php','.rb','.sql','.graphql','.proto','.md','.mdx','.txt','.csv','.json','.xml','.yaml','.yml','.html','.css','.scss','.c','.cpp','.h','.sh','.properties','.pdf','.docx']);
export const hash = data => createHash('sha256').update(data).digest('hex');
const arr = x => !x ? [] : Array.isArray(x) ? x : [x];
export function parseSvn(infoXml, statusXml) {
  const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseAttributeValue:false,processEntities:false});
  const info = parser.parse(infoXml).info.entry;
  const entries = arr(parser.parse(statusXml).status.target).flatMap(t => arr(t.entry));
  return {kind:'svn', revision:`r${info.revision}`, url: info.url, uuid:info.repository?.uuid,
    dirty:entries.some(e => !['normal','unversioned','ignored','external','none'].includes(e['wc-status'].item) || ['modified','conflicted'].includes(e['wc-status'].props)),
    entries:entries.filter(e => !['unversioned','ignored','external','none','deleted','missing'].includes(e['wc-status'].item)).map(e => ({path:e.path,revision:e['wc-status'].revision || 'added'}))};
}
async function command(cmd,args,root) { return (await execute(cmd,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000,windowsHide:true})).stdout; }
export async function detectVersion(root) {
  try {
    const info = await command('svn',['info','--xml','.'],root);
    return parseSvn(info, await command('svn',['status','--xml','--verbose','--ignore-externals','.'],root));
  } catch {}
  try {
    const revision = (await command('git',['rev-parse','HEAD'],root)).trim();
    return {kind:'git',revision,dirty:!!(await command('git',['status','--porcelain'],root)).trim(),entries:(await command('git',['ls-files','-z'],root)).split('\0').filter(Boolean).map(p=>({path:p}))};
  } catch {}
  let parent = root;
  while (true) {
    if (await fs.stat(path.join(parent,'.svn')).catch(()=>null)) return {kind:'folder',revision:'文件快照',warning:'检测到 SVN 工作副本，但无法读取版本。请检查 svn 命令行客户端；本次使用文件哈希记录来源。'};
    if(path.dirname(parent)===parent) break;
    parent=path.dirname(parent);
  }
  return {kind:'folder',revision:'文件快照'};
}
export async function safePath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('无效的资料路径');
  const base = await fs.realpath(root);
  const resolved = await fs.realpath(path.resolve(base,relative));
  const rel = path.relative(base,resolved);
  if (rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel)) throw new Error('资料路径超出了授权目录');
  return resolved;
}
export async function extractText(file, buffer) {
  const ext=path.extname(file).toLowerCase();
  if(ext==='.docx') {
    const {unzipSync}=await import('fflate');
    let oversized=false;
    const files=unzipSync(buffer,{filter:entry=>{if(entry.name!=='word/document.xml')return false;if(entry.originalSize>20*1024*1024){oversized=true;return false;}return true;}});
    if(oversized)throw new Error('Word 解压后的正文超过 20 MB，请拆分后导入');
    if(!files['word/document.xml'])throw new Error('Word 文件缺少正文');
    const xml=new TextDecoder().decode(files['word/document.xml']);
    const tree=new XMLParser({preserveOrder:true,ignoreAttributes:true,processEntities:false,parseTagValue:false,trimValues:false}).parse(xml);
    const decode=value=>String(value).replace(/&(amp|lt|gt|quot|apos);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name]));
    function walk(nodes){return nodes.map(node=>Object.entries(node).map(([key,value])=>{
      if(key==='#text')return decode(value);
      if(key==='w:tab')return '\t';if(key==='w:br')return '\n';
      const text=Array.isArray(value)?walk(value):'';return text+(key==='w:p'?'\n':'');
    }).join('')).join('');}
    return walk(tree);
  }
  if(ext==='.pdf') {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=getDocument({data:new Uint8Array(buffer),useSystemFonts:true,isEvalSupported:false});
    const pdf=await task.promise;
    try {
      if(pdf.numPages>300) throw new Error('PDF 超过 300 页，请拆分后导入');
      const pages=[];
      for(let i=1;i<=pdf.numPages;i++) {
        const page=await pdf.getPage(i);const text=await page.getTextContent();
        pages.push(`[第 ${i} 页]\n`+text.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join(''));
      }
      return pages.join('\n\n');
    } finally { await task.destroy(); }
  }
  if(buffer.includes(0)) throw new Error('二进制或非 UTF-8 文件');
  try { return new TextDecoder('utf-8',{fatal:true}).decode(buffer); }
  catch { throw new Error('当前仅支持 UTF-8 文本，请转换编码后重新扫描'); }
}
function excluded(relative) {
  const parts=relative.split(/[\\/]/);const name=parts.at(-1).toLowerCase();
  return parts.some(p=>SKIP.has(p)) || name.startsWith('.env') || /\.(pem|key|p12|pfx|keystore)$/.test(name) || /^(credentials|secrets)(\.|$)/.test(name) || /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(name);
}
export async function scanSources(sources, {signal,onProgress=()=>{}}={}) {
  const files=[],skipped=[],versions=[];let visited=0;
  for(const source of sources) {
    signal?.throwIfAborted();
    const root=await fs.realpath(source.root);
    const version=source.paths?.length ? {kind:'documents',revision:'文件快照'} : await detectVersion(root);
    versions.push({sourceId:source.id,...version,entries:undefined});
    const revisions=new Map((version.entries||[]).map(e=>[e.path.replaceAll('\\','/'),e.revision]));
    let candidates=[];
    if(source.paths?.length) candidates=source.paths;
    else if(version.entries) candidates=version.entries.map(e=>e.path);
    else {
      async function walk(dir) {
        signal?.throwIfAborted();
        for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
          if(++visited>50000) throw new Error('目录条目超过 50,000 个，请按模块拆分资料目录');
          const full=path.join(dir,entry.name), rel=path.relative(root,full);
          if(excluded(rel)||entry.isSymbolicLink()) continue;
          if(entry.isDirectory()) await walk(full);else if(entry.isFile()) candidates.push(rel);
        }
      }
      await walk(root);
    }
    if(candidates.length>50000) throw new Error('文件过多，请选择更小的模块目录');
    for(const relative of candidates.sort()) {
      signal?.throwIfAborted();
      const rel=relative.replaceAll('\\','/');
      if(excluded(rel)||!EXT.has(path.extname(rel).toLowerCase())) continue;
      try {
        const full=await safePath(root,relative), stat=await fs.stat(full);
        if(!stat.isFile()) continue;
        const maxBytes=/\.(pdf|docx)$/i.test(rel)?10*1024*1024:1024*1024;
        if(stat.size>maxBytes) throw new Error('文件过大，请拆分（文本 1 MB / 文档 10 MB）');
        const raw=await fs.readFile(full), text=await extractText(full,raw);
        if(!text.trim()) throw new Error('未提取到文字；扫描件需要先 OCR');
        const lineCount=text.split('\n').length;
        const id=hash(source.id+':'+rel).slice(0,20);
        files.push({id,sourceId:source.id,path:rel,hash:hash(raw),bytes:raw.length,lines:lineCount,revision:revisions.get(rel)||version.revision,kind:/\.(md|txt|pdf|docx|csv)$/i.test(rel)?'document':'code',textHash:hash(text)});
        files.at(-1).structure=extractStructure(rel,text);
        if(files.length%25===0) onProgress(`已索引 ${files.length} 个文件`);
      } catch(error) { skipped.push({sourceId:source.id,path:rel,reason:error.message}); }
    }
  }
  return {id:randomUUID(),at:new Date().toISOString(),files,skipped,versions,graph:buildGraph(files)};
}
export function compareIndex(before, after) {
  const a=new Map((before?.files||[]).map(f=>[f.id,f])),b=new Map(after.files.map(f=>[f.id,f]));
  return {added:after.files.filter(f=>!a.has(f.id)).map(f=>f.id),modified:after.files.filter(f=>a.has(f.id)&&a.get(f.id).hash!==f.hash).map(f=>f.id),deleted:[...a.values()].filter(f=>!b.has(f.id)).map(f=>f.id)};
}
export async function readEvidence(project,fileId) {
  const item=project.index?.files.find(f=>f.id===fileId);if(!item) throw new Error('该资料不在当前索引中，请重新扫描');
  const source=project.sources.find(s=>s.id===item.sourceId);if(!source) throw new Error('资料来源已移除');
  const full=await safePath(source.root,item.path), raw=await fs.readFile(full);
  if(hash(raw)!==item.hash) throw new Error(`${item.path} 已发生变化，请先重新扫描`);
  const text=await extractText(full,raw);
  if(hash(text)!==item.textHash) throw new Error('文档解析结果已变化，请重新扫描');
  return {...item,text};
}
export function makeChunks(evidence, maxChars=24000) {
  const result=[];let parts=[],size=0;
  const flush=()=>{if(parts.length)result.push(parts);parts=[];size=0;};
  for(const file of evidence) {
    const lines=file.text.split('\n');let start=0,body=[],len=0;
    const add=()=>{
      if(!body.length)return;
      const part={fileId:file.id,path:file.path,start:start+1,end:start+body.length,hash:file.hash,revision:file.revision,text:body.join('\n')};
      const cost=part.text.length+300;
      if(size+cost>maxChars)flush();
      parts.push(part);size+=cost;body=[];len=0;
    };
    for(let i=0;i<lines.length;i++) {
      if(lines[i].length>maxChars-1000) throw new Error(`${file.path} 第 ${i+1} 行过长，请排除压缩文件`);
      const line=`${i+1}: ${lines[i]}`;
      if(len+line.length+1>maxChars-1000){add();start=i;}
      body.push(line);len+=line.length+1;
    }
    add();
  }
  flush();return result;
}
