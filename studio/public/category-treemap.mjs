export function categoryPeriod(today, mode = "month") {
  const to = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0,10);
  const from = mode === "year" ? today.slice(0,4) + "-01-01" : today.slice(0,7) + "-01";
  return {from, to, empty: from > to};
}
/** Squarified layout: area is proportional to revenue, never to rank. */
export function treemapLayout(items, width = 1000, height = 520, measure = "revenue") {
  const sorted = items
    .filter((item) => Number.isFinite(item[measure]) && item[measure] > 0)
    .map((item) => ({ ...item }))
    .sort((a, b) => b[measure] - a[measure]);
  const total = sorted.reduce((sum, item) => sum + item[measure], 0);
  if (!total) return [];
  const remaining = sorted.map((item) => ({
    ...item,
    area: (item[measure] / total) * width * height,
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
  if (Math.abs(delta) < 2 - 1e-9) return "flat";
  return delta > 0 ? "growth" : "decline";
}
export function categoryColor(delta) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const step = Math.floor((Math.abs(delta) + 1e-9) / 2);
  if (!step) return { band: 0, background: "rgb(244,246,250)", foreground: "#0c253e" };
  const pale = [244,246,250], end = delta > 0 ? [54,72,191] : [180,35,24];
  const intensity = 1 - Math.exp(-step / 10);
  const rgb = pale.map((value,index) => Math.round(value + (end[index] - value) * intensity));
  const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum,value,index) => sum + value * [.2126,.7152,.0722][index],0);
  const lum = luminance(rgb), dark = luminance([12,37,62]);
  const whiteContrast = 1.05 / (lum + .05), darkContrast = (lum + .05) / (dark + .05);
  const foreground = whiteContrast >= 4.5 ? "#ffffff" : darkContrast >= 4.5 ? "#0c253e" : "#000000";
  return { band: (delta > 0 ? 1 : -1) * step, background: `rgb(${rgb.join(",")})`, foreground };
}
export function categoryMosaic(current, previous, compare = true, {limit = 9, otherLabel = 'Інші категорії', width = 1000, height = 520, measure = 'revenue', unit} = {}) {
  const value = row => unit ? row.quantities?.[unit] ?? 0 : row[measure];
  const all = (current || []).map(row => ({...row, [measure]: value(row)}))
    .filter((row) => row[measure] > 0)
    .sort((a, b) => b[measure] - a[measure]);
  const baseline = previous
    ? new Map(previous.map(row => [row.label, unit && row.missingQuantityLines ? null : value(row)]))
    : null;
  const rows = all
    .slice(0, limit)
    .map((row) => ({ ...row, prior: baseline?.get(row.label) ?? null }));
  if (all.length > limit) {
    const top = new Set(rows.map((row) => row.label)), rest = all.slice(limit);
    const priorRest = baseline && [...baseline].filter(([label]) => !top.has(label)).map(([, prior]) => prior);
    rows.push({
      label: otherLabel,
      revenue: rest.reduce((sum, row) => sum + row.revenue, 0),
      docs: rest.reduce((sum, row) => sum + (row.docs || 0), 0),
      goods: rest.reduce((sum, row) => sum + (row.goods || 0), 0),
      prior: priorRest && !priorRest.includes(null) ? priorRest.reduce((sum, prior) => sum + prior, 0) : null,
      missingQuantityLines: unit && current.some(row => !top.has(row.label) && row.missingQuantityLines),
      items: rest,
    });
  }
  return treemapLayout(
    rows.map((row) => {
      const delta =
        compare && row.prior > 0 && !(unit && row.missingQuantityLines) ? (row[measure] / row.prior - 1) * 100 : null;
      return { ...row, delta, tone: categoryTone(delta), color: categoryColor(delta) };
    }), width, height, measure,
  );
}
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const tooltipRow = (label, value) => `<div class="bo-quarter-tip-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
export function bindCategoryTooltips(root = document) {
  root.querySelectorAll("[data-category-meta]").forEach((tile) => {
    const tooltip = tile.closest('.bo-card')?.querySelector('.bo-category-tooltip');
    if (!tooltip) return;
    const data = JSON.parse(tile.dataset.categoryMeta);
    const show = (event) => {
      tile.classList.add("is-hovered");
      tile.setAttribute("aria-describedby", tooltip.id);
      tooltip.innerHTML = `<div class="bo-category-tip-name">${esc(data.label)}</div><small>${esc(data.measureLabel)}</small>` +
        tooltipRow(data.period, data.formattedValue) + (data.baselineLabel
          ? tooltipRow(data.baselineLabel, data.formattedPrior) + tooltipRow('Зміна', data.formattedDelta)
          : '');
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
