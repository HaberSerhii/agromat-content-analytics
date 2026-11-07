type SearchableCart = {
  id: number; product: string; sku: string; promo_code: string | null;
  name: string; raw?: { ip?: string | null };
};
/** Search defines the shared cohort for statistics, charts, register and export. */
export function filterCartSearch<T extends SearchableCart>(carts: T[], search: string): T[] {
  const query = search.trim().toLocaleLowerCase("uk-UA");
  if (!query) return carts;
  return carts.filter(cart => `${cart.id} ${cart.product} ${cart.sku} ${cart.promo_code ?? ""} ${cart.name} ${cart.raw?.ip || ""}`.toLocaleLowerCase("uk-UA").includes(query));
}
