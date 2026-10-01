# CVS_PHANToM Backend DEV Progress

## Status

**Last updated:** `2026-10-01` (Asia/Bangkok)

This document began as the isolated DEV handoff record. On `2026-10-01`, after
the owner stopped all users and explicitly authorized the production cutover,
CVS_PHANToM was moved to the verified Worker/D1 architecture. Historical DEV evidence
is retained below for provenance.

Current production path:

```text
Vercel frontend
  -> password/access-code login
  -> signed Worker session token
  -> Cloudflare Worker cvs-phantom-api-dev
       -> D1 cvs-phantom-db-dev
       -> durable sync_outbox
       -> signed Apps Script bridge
       -> production CVS_PHANToM Google Sheet

Worker Cron (*/5)
  -> every 15 minutes: signed getFreshSheetSnapshot bridge read
  -> D1 reconciliation
```

The original Phase 0 / Decision Gate A measurement package is still incomplete.
Production cutover is therefore recorded as an explicit owner operational decision,
not as retroactive completion of the historical gate. CVS_SME remains untouched.

## Current Production Resources

| Resource | Current state |
| --- | --- |
| Worker | `cvs-phantom-api-dev` (historical name), deployed version `056de3be-3203-43e3-bf34-4fe17ee41080` |
| Worker schedule | `*/5 * * * *`; production Sheet pull is gated to UTC minutes divisible by 15 |
| D1 | `cvs-phantom-db-dev` (historical name), now holding production CVS_PHANToM state |
| D1 migrations | `0001_init.sql` through `0004_auth_rate_limit.sql` |
| Apps Script bridge | signed standalone bridge, deployment `@14`, targeting production `CVS_PHANToM` Sheet |
| Production Sheet snapshot | 3 teams, 674 stores, 8 report-config accounts, 505 config items |
| Browser authentication | user/admin access-code login -> signed 12-hour session token in `sessionStorage` |
| Allowed browser origins | `https://sme-cvse20.vercel.app` and GitHub Pages fallback |
| Admin mutations | enabled, but Worker requires an `admin` or `service` role |
| Edge cache | disabled: `ENABLE_EDGE_CACHE=0` |
| Team scope | `DB_GBKK4`, `DB_GBKK2`, `SME_CVS20` |
| CVS_SME | isolated and untouched |

Secrets remain outside Git. Worker secret names include `BRIDGE_URL`,
`BRIDGE_SECRET`, `DEV_API_TOKEN`, `SHEET_SYNC_SECRET`, `SESSION_SECRET`,
`USER_ACCESS_CODE`, and `ADMIN_ACCESS_CODE`.

## Implemented

- Production Worker API reads and operational writes backed by D1.
- Composite store identity `(team_id, store_id)`.
- Independent versions for master, noted, route, location, and visit state.
- Persistent API idempotency receipts.
- D1 transaction-style batches for operational state + audit + sync outbox.
- Durable D1 -> Sheet outbox with retry/backoff, lease protection, error/dead state,
  and Sheet-version shadow tracking.
- HMAC-SHA256 Worker -> Apps Script bridge requests with timestamp and nonce checks.
- HMAC-SHA256 Sheet-snapshot ingress with durable nonce replay protection.
- Sheet reconciliation that distinguishes unchanged Sheet shadow from an intentional
  manual Sheet edit and can supersede dead conflict jobs.
- Stale-snapshot protection using `generatedAt`.
- Production allowlists for the three CVS_PHANToM teams and approved report accounts.
- Worker Cron runs every five minutes; a complete signed production Sheet snapshot is
  reconciled every 15 minutes through the read-only `getFreshSheetSnapshot` bridge action.
- Browser-safe user/admin authentication uses access codes only at login; the browser
  receives a signed 12-hour session token and never receives the service token.
- Main page, Report, and Report Admin use Worker/D1 by default. `?backend=legacy`
  retains the Apps Script path as the emergency rollback.
- Report-config writes require an `admin` or `service` role.
- No-op snapshot reconciliation skips unchanged team/store/config rows to protect the
  D1 write quota; regression coverage is in `test/d1-write-regression.mjs`.

## Verified Evidence

Local/static verification:

- `node --check` passes for Worker and bridge source.
- `worker-smoke.mjs`, `bridge-smoke.cjs`, and `d1-write-regression.mjs` pass.
- `git diff --check` passes.
- A fresh local D1 applies migrations `0001` through `0004` successfully.

Production integration evidence:

- Worker `/health` reports `environment=production`, `backend=d1`, and all
  authentication/bridge configuration flags enabled.
- Worker `/internal/status` reports 3 teams, 674 stores, and 20 completed outbox
  jobs with no pending/error/dead rows reported.
- A complete signed production Sheet pull returns 3 teams, 674 stores, 8 report
  config accounts, 505 config items, and `superseded=0`.
- User session authentication can read the three teams but receives 403 from an
  admin endpoint; an admin session is recognized as `admin`.
- CORS preflight succeeds for the production Vercel and GitHub Pages origins and is
  rejected for an unapproved origin.
- Production Vercel checks returned HTTP 200 for the main page, authentication
  assets, Report Admin, and Report; Worker references were present in each expected page.
- A LAWSON report-config no-op write was verified end-to-end with a stable version
  and completed Sheet projection.
- The no-op D1 quota fix is verified directly: after a successful production Sheet
  pull, `MAX(updated_at)` remained exactly unchanged for all three reconciled tables:
  stores `2026-10-01T04:56:16.386Z`, teams `2026-10-01T09:45:12.394Z`, and
  report config `2026-10-01T07:02:22.700Z`. The verification query itself wrote
  zero rows. This proves an unchanged snapshot no longer rewrites the 674 stores.
- Commit `a1ec499` contains the D1 no-op write fix and is pushed to `origin/main`.

Historical isolated DEV evidence remains useful for the Worker/bridge contract:
route, noted, location, report-config projection/retry/conflict/restore tests passed;
snapshot bad-signature, malformed-payload, and replay protections passed; staging
Sheet/D1 parity returned to zero mismatches after reversible tests.

## Current Production State

The production cutover is complete. Worker/D1 is the default path for the main page,
Report, and Report Admin. The frontend obtains short-lived signed session tokens from
the Worker and does not contain `DEV_API_TOKEN` or other Worker secrets.

`?backend=legacy` remains the immediate browser rollback to the prior Apps Script
path. CVS_SME remains a separate deployment and was not modified or connected.

The D1 `rows_written_24h` metric still contains historical writes from before the
quota fix and therefore decays on a rolling 24-hour window. Judge the fix by direct
no-op reconciliation evidence rather than expecting that rolling metric to reset
immediately.

## Known Boundaries

- Phase 0 historical workload measurements (representative p50/p95, failure rate,
  active users, and quota baseline) were never completed before the owner-authorized
  production cutover; do not rewrite history to mark that gate complete.
- Production still relies on the Apps Script bridge and Google Sheet as the external
  projection/source-reconciliation layer.
- Full Sheet snapshots remain intentionally simple at the present 674-store scale;
  re-measure before reusing this design for materially larger datasets.
- Keep all session/access/service/bridge secrets outside Git.
- Do not merge CVS_SME resources, data, secrets, or deployment paths into CVS_PHANToM.

## Safe Next Action

Operate the current production path without further architecture changes while
observing Worker health, outbox state, Sheet reconciliation, and the rolling D1
write metric during normal live usage. Preserve `?backend=legacy` during this
stabilization window. Any future mutation/recovery test that can affect production
data must have an explicit reversible fixture and restore check.
