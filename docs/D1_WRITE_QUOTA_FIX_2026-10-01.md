# D1 write-quota fix — 2026-10-01

Cloudflare warned that the account had reached 75% of the Free D1 daily
`rows_written` allowance. Inspection of `cvs-phantom-db-dev` showed
82,394 rows written in the rolling 24-hour view immediately before the fix.

## Root cause

The 15-minute Sheet reconciliation treated every complete snapshot as a full
rewrite. It deactivated all active teams/stores and then UPSERTed all 674
stores plus report configuration even when no source value had changed.

## Fix

Reconciliation now:
- deactivates only teams/stores absent from the complete snapshot;
- skips team UPSERT updates when identity/source/active state is unchanged;
- skips store UPSERT updates when all master/field/sheet versions are unchanged;
- skips report-config UPSERT updates when content/version is unchanged.

The five-minute outbox schedule and 15-minute Sheet pull remain enabled.

## Verification

After deployment, authenticated manual Sheet pulls returned 3 teams,
674 stores, 8 report-config accounts and 505 config items with
`superseded=0`; Worker status continued to show 20 completed outbox jobs
and no pending/error/dead work.

A direct no-op proof was then run around another successful production pull.
The maximum `updated_at` values remained exactly unchanged before and after:

- stores (674 rows): `2026-10-01T04:56:16.386Z`;
- teams (3 rows): `2026-10-01T09:45:12.394Z`;
- report-config sets (8 rows): `2026-10-01T07:02:22.700Z`.

The verification query itself reported zero rows written. This demonstrates
that an unchanged complete snapshot no longer rewrites the 674 store rows or
the unchanged team/report-config rows.

The Cloudflare `rows_written_24h` value remains a rolling historical metric,
so writes from before the fix stay visible until they age out of the 24-hour
window. It should not be interpreted as a fresh write count for one pull.

A lightweight regression guard is in
`workers/cvs-phantom-api-dev/test/d1-write-regression.mjs`. The deployed
fix is committed as `a1ec499` and pushed to `origin/main`.
