// Tracebase 示例代码：仅用于演示业务资料扫描。
import {requiresAfterSale} from './cancellation-policy';
type Order = { id: string; status: 'pending' | 'paid' | 'shipped'; stockReserved: boolean };
export function cancelOrder(order: Order, userOwnsOrder: boolean) {
  if (!userOwnsOrder) throw new Error('无权取消其他用户的订单');
  if (requiresAfterSale(order.status)) throw new Error('已发货订单需要进入售后流程');
  if (order.status === 'paid') return { action: 'request_refund', releaseStock: order.stockReserved };
  return { action: 'close_order', releaseStock: order.stockReserved };
}
