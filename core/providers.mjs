// Presets are convenience defaults. Users can edit the endpoint and model ID.
// Kimi documentation checked 2026-10-16: https://platform.kimi.com/docs/models
export const PROVIDERS={
  custom:{label:'自定义兼容接口',baseUrl:'',model:'',models:[]},
  kimi:{label:'Kimi / Moonshot',baseUrl:'https://api.moonshot.cn/v1',model:'kimi-k3',models:['kimi-k3','kimi-k2.7-code','kimi-k2.7-code-highspeed','kimi-k2.6']},
  deepseek:{label:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',models:['deepseek-chat','deepseek-reasoner']},
  qwen:{label:'通义千问',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus',models:['qwen-plus','qwen-turbo','qwen-max']},
  local:{label:'本地模型 / Ollama',baseUrl:'http://localhost:11434/v1',model:'',models:[]}
};
export function providerParameters(config,maxTokens){
  if(config.provider!=='kimi')return {max_tokens:maxTokens};
  const testing=maxTokens<=64;
  if(config.model==='kimi-k3')return {max_tokens:testing?4096:Math.max(maxTokens,16000),reasoning_effort:testing?'low':'high'};
  if(config.model==='kimi-k2.6')return {max_tokens:maxTokens,thinking:{type:'disabled'}};
  if(config.model.startsWith('kimi-k2.7-code'))return {max_tokens:testing?4096:Math.max(maxTokens,16000)};
  return {max_tokens:maxTokens};
}
