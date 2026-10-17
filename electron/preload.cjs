const {contextBridge,ipcRenderer}=require('electron');
const actions=['state','createProject','selectProject','chooseSources','removeSource','scan','saveModel','testModel','saveFeishu','testFeishu','previewAnalysis','previewQuestion','answerQuestion','startAnalysis','cancelAnalysis','resumeAnalysis','readSource','updateArticle','applyUpdate','exportMarkdown','publish','openLink','importExample'];
contextBridge.exposeInMainWorld('tracebase',{
  desktop:true,
  call:(action,...args)=>{if(!actions.includes(action))return Promise.reject(new Error('不支持的操作'));return ipcRenderer.invoke('tracebase:action',action,args).then(result=>{if(result.error)throw new Error(result.error);return result.value;});},
  onChange:callback=>{const handler=()=>callback();ipcRenderer.on('tracebase:changed',handler);return()=>ipcRenderer.removeListener('tracebase:changed',handler);}
});
