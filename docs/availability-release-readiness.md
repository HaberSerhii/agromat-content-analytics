# Availability release preparation — 2026-11-07

Prepared locally for a combined release. No commit, push or deployment performed by this task.

## Scope

- Four summary cards: active/inactive for the selected month and the previous calendar month, with signed net changes.
- Click totals for monthly membership; click changes for added/removed SKU lists, with filters and pagination.
- Membership uses exact historical snapshots; current catalogue supplies display names, SKU and links only.
- Missing detailed history produces an explicit message, never a selection based on today's statuses.

## Files to include with the combined availability work

- `src/components/ProductAvailabilityAnalysis.tsx`
- `src/app/api/products/availability/route.ts`
- `src/lib/product-availability-selection.ts`
- `tests/product-availability-selection.test.mjs`
- `tests/product-availability.test.mjs` (updated preorder assertion for concurrent availability changes)
- `docs/product-availability.md`
- This note

Dependencies already present in the working tree must also be included: `src/lib/product-availability.ts`, `src/lib/product-availability-report.ts`, `src/lib/product-availability-daily.ts`, `src/lib/product-availability-daily-store.ts`, their tests and snapshot-writing integration in `src/lib/products-store.ts`.

## Verification

- `npm run build`: passed, including lint and type checks.
- `node --test tests/product-availability*.test.mjs`: 13 passed.
- Other tasks are editing this working tree; rerun checks against the final combined revision before release.

## Production follow-up

Preserve the existing product snapshot directories. Historical drilldown requires detailed snapshots matching monthly observation timestamps; aggregates alone cannot reconstruct product IDs. After the combined release, verify totals and changes against production snapshots. Commit relevant source and project instructions, push, deploy the pushed revision, and verify the running revision as required by `AGENTS.md`. Exclude generated preview images.
