type DimensionOrder = {
  state: string;
  createdDate: string;
  shippedDate: string | null;
};

/** Brand/category sales require both creation and full shipment in the selected period. */
export function isDimensionOrderInPeriod(
  row: DimensionOrder,
  filter: { from: string | null; to: string | null },
) {
  if (!row.state.toLocaleLowerCase("uk").includes("повністю відвантаж")) return false;
  const created = row.createdDate.trim().slice(0, 10);
  const shipped = row.shippedDate?.trim().slice(0, 10);
  if (!created || !shipped || shipped < created) return false;
  return [created, shipped].every((date) => (
    (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to)
  ));
}

/** Exclude delivery lines, not entire mixed orders or all unbranded products. */
export function isDeliverySalesItem(item: { code: string; name: string; brand: string; category: string }) {
  // Service code observed in the sales feed: «Транспортні послуги».
  if (item.code.trim() === "18385") return true;
  const categoryAndBrand = `${item.category} ${item.brand}`.toLocaleLowerCase("uk");
  if (/доставк|\bdelivery\b|\bshipping\b/u.test(categoryAndBrand)) return true;
  const name = item.name.toLocaleLowerCase("uk").trim();
  return /^(?:доставк|(?:послуги|послуга|услуги|услуга)\s+доставк|транспортні послуги|транспортные услуги|delivery\b|shipping\b)/u.test(name);
}
