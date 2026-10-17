// 虚构规则：用于验证跨文件依赖补全，不代表任何真实业务。
export function requiresAfterSale(status: string) {
  return status === 'shipped';
}
