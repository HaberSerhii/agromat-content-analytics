import { revenueWaterfall, waterfallComparison } from "./public/revenue-drivers.mjs";
export { revenueWaterfall, waterfallComparison };
export async function loadRevenueWaterfall(range, mode, load) {
  const comparisonRange = waterfallComparison(range, mode);
  const pack = async (period) => {
    const [all, site, rozetka, monomarket, web] = await Promise.all([
      ...["all", "site", "rozetka", "monomarket"].map((channel) =>
        load("sales", new URLSearchParams({ channel }), period),
      ),
      load("channels", new URLSearchParams(), period),
    ]);
    return { all, site, rozetka, monomarket, traffic: web };
  };
  const [current, previous] = await Promise.all([
    pack(range),
    pack(comparisonRange),
  ]);
  return revenueWaterfall(current, previous, range, comparisonRange, mode);
}
