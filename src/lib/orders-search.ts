type SearchableOrder = {
  id: number;
  order_num?: number | string | null;
  order_doc_id?: number | string | null;
  origin?: { source?: string | null; external_order_id?: number | string | null } | null;
  customer: { legal_name?: string | null; last_name?: string | null; first_name?: string | null; patronymic?: string | null; email?: string | null; phone?: string | null };
  status?: string | null;
  erp_manager?: string | null;
  items: Array<{ goods_ref?: number | null; code?: number | string | null; sku?: string | null; name?: string | null }>;
};

export function matchesOrderSearch(order: SearchableOrder, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("uk");
  if (!normalized) return true;
  const origin = order.origin?.source?.trim().toLowerCase() || "webshop";
  const originLabel = origin === "webshop" ? "Вебшоп AGROMAT" : origin === "rozetka" ? "Rozetka" : origin;
  return [
    order.id, order.order_num, order.order_doc_id, order.origin?.external_order_id,
    originLabel,
    order.customer.legal_name,
    [order.customer.last_name, order.customer.first_name, order.customer.patronymic].filter(Boolean).join(" "),
    order.customer.email, order.customer.phone, order.status, order.erp_manager,
    ...order.items.flatMap(item => [item.goods_ref, item.code, item.sku, item.name]),
  ].some(value => String(value ?? "").toLocaleLowerCase("uk").includes(normalized));
}
