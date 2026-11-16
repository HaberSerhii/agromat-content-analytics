export function categoryPeriod(today, mode = "month") {
  const to = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0,10);
  const from = mode === "year" ? today.slice(0,4) + "-01-01" : today.slice(0,7) + "-01";
  return {from, to, empty: from > to};
}
/** Squarified layout: area is proportional to revenue, never to rank. */
export function treemapLayout(items, width = 1000, height = 520) {
  const sorted = items
    .filter((item) => Number.isFinite(item.revenue) && item.revenue > 0)
    .map((item) => ({ ...item }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((sum, item) => sum + item.revenue, 0);
  if (!total) return [];
  const remaining = sorted.map((item) => ({
    ...item,
    area: (item.revenue / total) * width * height,
  }));
  const result = [];
  let rect = { x: 0, y: 0, w: width, h: height };
  const worst = (row, side) => {
    if (!row.length) return Infinity;
    const areas = row.map((item) => item.area),
      sum = areas.reduce((a, b) => a + b, 0);
    return Math.max(
      (side * side * Math.max(...areas)) / (sum * sum),
      (sum * sum) / (side * side * Math.min(...areas)),
    );
  };
  function place(row) {
    const area = row.reduce((sum, item) => sum + item.area, 0),
      vertical = rect.w >= rect.h,
      thickness = area / (vertical ? rect.h : rect.w);
    let offset = 0;
    for (const item of row) {
      const length = item.area / thickness;
      result.push({
        ...item,
        x: rect.x + (vertical ? 0 : offset),
        y: rect.y + (vertical ? offset : 0),
        w: vertical ? thickness : length,
        h: vertical ? length : thickness,
      });
      offset += length;
    }
    if (vertical) {
      rect.x += thickness;
      rect.w -= thickness;
    } else {
      rect.y += thickness;
      rect.h -= thickness;
    }
  }
  let row = [];
  while (remaining.length) {
    const next = remaining[0],
      side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, next], side) <= worst(row, side)) {
      row.push(remaining.shift());
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return result;
}
export function categoryTone(delta) {
  if (delta == null || !Number.isFinite(delta)) return "missing";
  if (Math.abs(delta) <= 1) return "flat";
  if (delta > 0) return delta >= 15 ? "growth-strong" : "growth";
  return delta <= -15 ? "decline-strong" : "decline";
}
export function categoryMosaic(current, previous, compare = true) {
  const all = [...(current || [])]
    .filter((row) => row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const baseline = previous
    ? new Map(previous.map((row) => [row.label, row.revenue]))
    : null;
  const rows = all
    .slice(0, 9)
    .map((row) => ({ ...row, prior: baseline?.get(row.label) ?? null }));
  if (all.length > 9) {
    const top = new Set(rows.map((row) => row.label)),
      rest = all.slice(9);
    rows.push({
      label: "Інші категорії",
      revenue: rest.reduce((sum, row) => sum + row.revenue, 0),
      docs: rest.reduce((sum, row) => sum + (row.docs || 0), 0),
      goods: rest.reduce((sum, row) => sum + (row.goods || 0), 0),
      prior: baseline
        ? [...baseline]
            .filter(([label]) => !top.has(label))
            .reduce((sum, [, value]) => sum + value, 0)
        : null,
      items: rest,
    });
  }
  return treemapLayout(
    rows.map((row) => {
      const delta =
        compare && row.prior > 0 ? (row.revenue / row.prior - 1) * 100 : null;
      return { ...row, delta, tone: categoryTone(delta) };
    }),
  );
}
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function bindCategoryTooltips(root = document) {
  const tooltip = root.querySelector("#category-mosaic-tooltip");
  if (!tooltip) return;
  root.querySelectorAll("[data-category-meta]").forEach((tile) => {
    const data = JSON.parse(tile.dataset.categoryMeta);
    const show = (event) => {
      tile.classList.add("is-hovered");
      tile.setAttribute("aria-describedby", tooltip.id);
      tooltip.innerHTML = `<div class="bo-category-tip-name">${esc(data.label)}</div><div class="bo-quarter-tip-row"><span>Виторг</span><b>${esc(data.formattedRevenue)}</b></div><div class="bo-quarter-tip-row"><span>До ${esc(data.baselineYear)}</span><b>${esc(data.formattedDelta)}</b></div>`;
      tooltip.hidden = false;
      const box = tile.getBoundingClientRect(),
        x = event?.clientX ?? box.right,
        y = event?.clientY ?? box.bottom;
      tooltip.style.left =
        Math.max(
          8,
          Math.min(x + 14, window.innerWidth - tooltip.offsetWidth - 8),
        ) + "px";
      tooltip.style.top =
        Math.max(
          8,
          Math.min(y + 14, window.innerHeight - tooltip.offsetHeight - 8),
        ) + "px";
    };
    const hide = () => {
      tooltip.hidden = true;
      tile.classList.remove("is-hovered");
      tile.removeAttribute("aria-describedby");
    };
    tile.addEventListener("pointerenter", show);
    tile.addEventListener("pointermove", show);
    tile.addEventListener("pointerleave", hide);
    tile.addEventListener("focus", () => show());
    tile.addEventListener("blur", hide);
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide();
    });
  });
}
