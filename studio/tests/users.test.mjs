import test from "node:test";
import assert from "node:assert/strict";
import { usersQuery, usersSafe } from "../bigquery-users.mjs";
test("users count is unique over the whole bounded period and queries are parameterized", () => {
  const q = usersQuery("project", "dataset", {
    from: "2026-11-01",
    to: "2026-11-14",
  });
  assert.match(q.query, /COUNT\(DISTINCT user_pseudo_id\)/);
  assert.match(q.query, /_TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix/);
  assert.deepEqual(q.params, {
    fromSuffix: "20261101",
    toSuffix: "20261114",
    country: "Ukraine",
  });
  assert.throws(() => usersQuery("project` injected", "dataset", {}));
});
test("public users response exposes aggregates without identifiers", () => {
  const d = usersSafe(
    {
      users: "123",
      data_from: "20261101",
      data_through: "20261114",
      user_pseudo_id: "private",
    },
    "2026-11-15T14:00:00Z",
  );
  assert.equal(d.users, 123);
  assert.equal(d.dataThrough, "2026-11-14");
  assert.ok(!JSON.stringify(d).includes("private"));
  assert.throws(() => usersSafe({ users: "invalid" }));
});
