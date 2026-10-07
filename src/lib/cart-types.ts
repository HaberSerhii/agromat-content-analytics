export type ApiCart = {
  id: number; status: "active" | "abandoned" | "converted"; anonymous: boolean;
  stage: string; checkout_step: number | null; furthest_stage: string; furthest_checkout_step: number | null;
  customer: { id: number | null; name: string | null; phone: string | null; email: string | null } | null;
  items: Array<{ type: string; id: number; sku: string; name: string; qty: number; price: number; sum: number; url?: string | null }>;
  items_count: number; total: number; currency: string; promo_code: string | null; promo_discount: number;
  delivery_point?: { type: string; warehouse_id: number | null; city: string | null; name: string | null; address: string | null } | null;
  checkout_fields: Record<string, string | number | boolean | null>; order_id: number | null; created_at: string; updated_at: string;
};
