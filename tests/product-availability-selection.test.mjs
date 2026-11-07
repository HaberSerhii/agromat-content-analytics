import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityMembers, availabilityChanges } from '../src/lib/product-availability-selection.ts';
const filter = { categories: [], brands: [], promotion: 'all' };
const snapshot = products => ({ products, categories: [['10', 'Tiles'], ['20', 'Bath']], brands: [['1', 'A'], ['2', 'B']] });
test('membership follows snapshot status, archive, category, brand and promotion', () => {
 const data = snapshot([[1,0,0,5,2],[2,0,0,5,1],[3,1,1,3,0],[1,0,0,5,2]]);
 assert.deepEqual([...availabilityMembers(data, filter, 'active').keys()], [1]);
 assert.deepEqual([...availabilityMembers(data, filter, 'inactive').keys()], [2,3]);
 assert.equal(availabilityMembers(data, {...filter, categories:['10'], brands:['B']}, 'inactive').size, 0);
 assert.equal(availabilityMembers(data, {...filter, promotion:'regular'}, 'active').size, 0);
});
test('changes include both directions, arrivals, disappearances and frozen filter membership', () => {
 const before = snapshot([[1,0,0,5,0],[2,0,0,5,0],[3,0,0,3,0],[5,0,0,5,0],[6,0,0,5,0]]);
 const after = snapshot([[1,0,0,5,0],[2,0,0,3,0],[3,0,0,5,0],[4,0,0,5,0],[6,1,0,5,0]]);
 const scoped = {...filter, categories:['10']};
 const changes = availabilityChanges(availabilityMembers(after, scoped, 'active'), availabilityMembers(before, scoped, 'active'));
 assert.deepEqual(changes.added.map(p => p.id), [3,4]);
 assert.deepEqual(changes.removed.map(p => p.id), [2,5,6]);
});
