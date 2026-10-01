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

After deployment, an authenticated manual Sheet pull returned 3 teams,
674 stores, 8 report-config accounts and 505 config items with no pending
outbox work. The immediately observed D1 rolling metric changed from
82,394 to 82,395 rows written; Cloudflare metrics may update asynchronously.

A lightweight regression guard is in
`workers/cvs-phantom-api-dev/test/d1-write-regression.mjs`.
