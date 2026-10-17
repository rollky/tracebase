const REPO='https://api.github.com/repos/rollky/tracebase/releases/latest';
export function newerVersion(current,next){const parse=v=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);const a=parse(current),b=parse(next);if(!a||!b)return false;for(let i=0;i<3;i++){if(b[i]!==a[i])return b[i]>a[i];}return false;}
export async function checkUpdates(current,{fetcher=fetch}={}){
  const response=await fetcher(REPO,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)throw new Error(`检查更新失败（HTTP ${response.status}），请稍后重试`);
  const data=await response.json();if(!/^v\d+\.\d+\.\d+$/.test(data.tag_name)||data.draft||data.prerelease)throw new Error('未找到有效的稳定版本');
  return {current,latest:data.tag_name,available:newerVersion(current,data.tag_name),url:`https://github.com/rollky/tracebase/releases/tag/${data.tag_name}`};
}
