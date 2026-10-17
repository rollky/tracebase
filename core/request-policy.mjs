import {setTimeout as delay} from 'node:timers/promises';

export async function retryRequest(operation,{signal,retries=2,onRetry=()=>{},wait=(ms,signal)=>delay(ms,undefined,{signal})}={}){
  for(let attempt=0;;attempt++){
    signal?.throwIfAborted();
    try{return await operation();}catch(error){
      if(signal?.aborted||attempt>=retries||![429,502,503,504].includes(error.status))throw error;
      const ms=Math.min(30000,Math.max(1000*2**attempt,error.retryAfterMs||0));
      await onRetry({attempt:attempt+1,ms,status:error.status});await wait(ms,signal);
    }
  }
}

// A single in-flight model request across all projects, plus a minimum interval.
export class ModelQueue{
  constructor(){this.tail=Promise.resolve();this.last=0;}
  async run(operation,{signal,intervalMs=500}={}){
    const before=this.tail;let release;this.tail=new Promise(r=>{release=r;});
    try{await before;signal?.throwIfAborted();const remaining=this.last+intervalMs-Date.now();if(remaining>0)await delay(remaining,undefined,{signal});signal?.throwIfAborted();this.last=Date.now();return await operation();}finally{release();}
  }
}

export function normalizeUsage(usage){
  if(!usage)return null;
  const input=usage.prompt_tokens??usage.input_tokens,output=usage.completion_tokens??usage.output_tokens;
  if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)return null;
  return {input,output,total:input+output};
}
