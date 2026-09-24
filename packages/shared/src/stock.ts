export const STOCK_STATUSES = ['available', 'reorder', 'out_of_stock'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const REORDER_THRESHOLD = 5;

export function suggestStockStatus(stock: number): StockStatus {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= REORDER_THRESHOLD) return 'reorder';
  return 'available';
}

export function summarizeStock(items: ReadonlyArray<{ stockStatus: StockStatus }>) {
  const summary = { total: items.length, available: 0, reorder: 0, out_of_stock: 0 };
  for (const item of items) summary[item.stockStatus] += 1;
  return summary;
}
