import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const controls = source.slice(source.indexOf('function rankingPanel('), source.indexOf('function salesChart('));
function setup() {
  const elements = Object.fromEntries(['#overview-sales-chart', '#overview-sales-ranking', '#chart-channel', '#sales-ranking'].map(key => [key, {}]));
  const context = vm.createContext({
    $$: () => [],
    state: { chartChannel: 'site', ranking: 'category' }, requestId: 1,
    data: { sales: { available: true, categories: ['all categories'], brands: ['all brands'] } },
    $: key => elements[key], panel: (title, subtitle, body) => body,
    bars: rows => rows.join(','), salesChart: result => JSON.stringify(result),
    chartControl: () => '', saveLocation() {}, bindContent() {},
    api: async () => ({ available: true, categories: ['site categories'], brands: ['site brands'] }),
  });
  vm.runInContext(controls, context);
  return { context, elements };
}
test('channel changes update ranking and grouping uses the same filtered response', async () => {
  const { context, elements } = setup();
  await vm.runInContext('updateOverviewChart()', context);
  assert.equal(elements['#overview-sales-ranking'].innerHTML, 'site categories');
  vm.runInContext('bindOverviewControls()', context);
  elements['#sales-ranking'].onchange({ target: { value: 'brand' } });
  assert.equal(elements['#overview-sales-ranking'].innerHTML, 'site brands');
  context.api = async () => context.data.sales;
  context.state.chartChannel = 'all';
  await vm.runInContext('updateOverviewChart()', context);
  assert.equal(elements['#overview-sales-ranking'].innerHTML, 'all brands');
});
test('unsupported and failed channels never show all-channel rankings', async () => {
  const { context, elements } = setup();
  context.state.chartChannel = 'prom';
  await vm.runInContext('updateOverviewChart()', context);
  assert.match(elements['#overview-sales-ranking'].innerHTML, /Prom/);
  context.state.chartChannel = 'site';
  context.api = async () => { throw new Error('offline'); };
  await vm.runInContext('updateOverviewChart()', context);
  assert.match(elements['#overview-sales-ranking'].innerHTML, /недоступні/);
});
