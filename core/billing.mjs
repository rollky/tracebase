export const monthKey=(at=new Date().toISOString())=>at.slice(0,7);
export function ensureBilling(state){return state.billing??={since:new Date().toISOString(),rates:[],budget:{enabled:false,monthlyLimit:100},months:[],reconciliations:[]};}
export function findRate(billing,config){return billing.rates.find(r=>r.baseUrl===config.baseUrl&&r.model===config.model)||null;}
const amount=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100000000)throw new Error('金额应为 0–100000000 的有效数字');return value;};
export function setRate(billing,config,input){
  if(!config.baseUrl||!config.model)throw new Error('请先保存模型配置');
  const rate={baseUrl:config.baseUrl,model:config.model,input:amount(input.input),output:amount(input.output)};
  billing.rates=billing.rates.filter(r=>r.baseUrl!==rate.baseUrl||r.model!==rate.model);billing.rates.push(rate);return rate;
}
export function setBudget(billing,input){const monthlyLimit=amount(input.monthlyLimit);if(monthlyLimit<=0)throw new Error('月预算必须大于零');billing.budget={enabled:!!input.enabled,monthlyLimit};}
export function recordUsage(billing,event){
  const month=monthKey(event.at);let row=billing.months.find(r=>r.month===month&&r.baseUrl===event.baseUrl&&r.model===event.model);
  if(!row){row={month,baseUrl:event.baseUrl,model:event.model,requests:0,failed:0,input:0,output:0,unknownUsage:0,unpriced:0,cost:0};billing.months.push(row);}
  row.requests++;if(!event.success)row.failed++;
  if(!event.usage)row.unknownUsage++;else{row.input+=event.usage.input;row.output+=event.usage.output;if(event.rate)row.cost+=(event.usage.input*event.rate.input+event.usage.output*event.rate.output)/1000000;else row.unpriced++;}
  const months=[...new Set(billing.months.map(r=>r.month))].sort().reverse().slice(0,36);billing.months=billing.months.filter(r=>months.includes(r.month));billing.reconciliations=billing.reconciliations.filter(r=>months.includes(r.month));
}
export function monthSummary(billing,month=monthKey()){
  const rows=billing.months.filter(r=>r.month===month),sum=key=>rows.reduce((n,r)=>n+r[key],0),cost=sum('cost'),uncertain=sum('unknownUsage')+sum('unpriced');
  const reconciliation=billing.reconciliations.find(r=>r.month===month);
  return {month,requests:sum('requests'),cost,unknownUsage:sum('unknownUsage'),unpriced:sum('unpriced'),uncertain:Math.max(0,uncertain-(reconciliation?.coveredUncertain||0)),budgetUsed:reconciliation?reconciliation.amount+cost-reconciliation.costSnapshot:cost,reconciliation};
}
export function reconcileMonth(billing,value,month=monthKey()){
  amount(value);const current=monthSummary(billing,month);billing.reconciliations=billing.reconciliations.filter(r=>r.month!==month);billing.reconciliations.push({month,amount:value,costSnapshot:current.cost,coveredUncertain:current.unknownUsage+current.unpriced,at:new Date().toISOString()});
}
export function assertBudget(billing,config,month=monthKey()){
  if(!billing.budget.enabled)return;
  if(!findRate(billing,config))throw new Error('预算控制已启用，请先配置当前模型单价');
  const summary=monthSummary(billing,month);
  if(summary.uncertain)throw new Error('本月存在未知用量或未计价请求，请核对服务商账单后补录本月累计金额，或关闭预算控制');
  if(summary.budgetUsed>=billing.budget.monthlyLimit)throw new Error('已达到本月预算阈值，后续模型请求已阻止');
}
export function recoverPendingBilling(state){
  const billing=ensureBilling(state);let changed=false;
  for(const e of state.usageEvents||[])if(e.billingState==='pending'){e.billingState='interrupted';e.success=false;e.usage=null;recordUsage(billing,e);changed=true;}
  return changed;
}
export function usageCsv(billing){
  const cell=v=>{let text=String(v??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const rows=[['月份 UTC','模型','服务地址','请求数','失败数','输入 Token','输出 Token','未知用量请求','未计价请求','已记录估算费用 CNY','跨模型月预算累计 CNY（勿按行求和）','人工补录时间'],...billing.months.slice().sort((a,b)=>b.month.localeCompare(a.month)).map(r=>{const summary=monthSummary(billing,r.month);return [r.month,r.model,r.baseUrl,r.requests,r.failed,r.input,r.output,r.unknownUsage,r.unpriced,r.cost.toFixed(6),summary.budgetUsed.toFixed(6),summary.reconciliation?.at||''];})];
  return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
