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
| Worker | `cvs-phantom-api-dev` (historical name), deployed version `c13b8796-7e0a-45cb-af3a-aee296d77528` |
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

- Authenticated DEV API reads and operational writes backed by D1.
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
- DEV allowlists for teams and report-config accounts.
- Worker Cron pull of a fresh staging Sheet snapshot every 15 minutes. The bridge
  exposes a read-only `getFreshSheetSnapshot` action; Apps Script no longer needs
  `UrlFetchApp` or `ScriptApp` trigger permissions for reconciliation. Remote D1
  audit evidence confirms scheduled pulls at 10:15 and 10:30 Asia/Bangkok.
- Admin reset/report-config mutation gates remain closed except during a bounded DEV
  test where the config is immediately restored to `0`.

## Verified Evidence

Local/static verification:

- `node --check` passes for Worker and bridge source.
- `worker-smoke.mjs` passes.
- `bridge-smoke.cjs` passes.
- `git diff --check` passes.
- A fresh local D1 applies `0001 -> 0002 -> 0003` successfully and produces the
  current required schema, including `sync_leases`, `inbound_nonces`,
  `sheet_*_version`, `report_config_sets.sheet_version`, and outbox `dead` status.

Remote DEV integration evidence:

- Bridge fresh snapshot returns `complete=true`, 1 team, 120 stores, and 8 report
  config accounts.
- Route: write -> Sheet projection -> idempotent retry -> stale-version 409 -> restore
  passed on current Worker/bridge contract.
- Noted: UTF-8 write -> Sheet projection -> restore passed.
- Location: write -> Sheet projection -> restore passed.
- Report config: temporary DEV admin enable -> write -> projection -> idempotent retry
  -> stale 409 -> restore passed; another account remained unchanged. Admin mutations
  were then redeployed back to `0`.
- Snapshot security: bad signature -> 401; a correctly signed invalid snapshot -> 400;
  replay of the same nonce -> 409 `REPLAYED_SHEET_NONCE`.
- After E2E restore, D1 and staging Sheet matched for all 120 active stores with
  **0 version-hash mismatches** across master/noted/route/location/visit.
- Manual Sheet -> D1 reconciliation passed on staging: `DB_GBKK4!J2` was changed
  from route `1` to a temporary test value, reconciled into D1 with matching
  `route_version` / `sheet_route_version`, restored to `1`, reconciled again,
  and full 120-store parity returned to 0 mismatches.
- Remote Cron reconciliation produced fresh `sheet_snapshot` audit events with
  120 stores, 8 config accounts, 505 config items, and `superseded=0`.

All current remote projection jobs are `done`; the latest status query showed 17
done and no error/dead outbox rows.

## Remaining Verification Before Frontend Work

1. Exercise the visit/reset recovery path with a fixture that can be restored safely;
   do not use production data.
2. Confirm error/dead-letter recovery with a controlled DEV bridge failure.
3. Record an explicit release/recovery checklist and a Git checkpoint.

Cron Sheet pull, reversible manual Sheet -> D1 reconciliation, restore, and final
120-store parity have now been verified.

## Frontend Pilot Scaffold

`index.html` now calls its existing API helpers through `Tools/backend-client.js`.
The default mode remains the existing Apps Script JSONP path, so no browser traffic
uses the Worker. The adapter preserves legacy response shapes and adds persistent
operation IDs to existing visit/noted outbox records; old queued records are migrated
in place when read. A future Worker pilot requires an in-memory, browser-safe
authorization provider. It does not read, store, or ship `DEV_API_TOKEN`.

Worker mode is therefore intentionally unavailable until a browser identity/session
mechanism is deployed and browser E2E coverage verifies authentication, CORS,
idempotent replay, version conflicts, and fallback behavior.

## Known Boundaries

- The shared DEV bearer token is not production user/role authorization.
- Production frontend cutover is not approved.
- Production Sheets/App Script are not part of this DEV backend.
- CVS_SME must not share Worker, D1, bridge, secrets, or team data with CVS_PHANToM.
- Phase 0 production workload evidence remains incomplete. The D1 DEV experiment is
  technical validation, not proof that D1 is required at production scale.
- Browser visit/noted outboxes retain the Apps Script default path; their persistent
  operation IDs are ready for a future Worker pilot but are not yet sent to Worker.
- Route/location remain online-only in the existing frontend.
- The Worker Cron pull architecture currently uses full snapshots. At present scale
  (120 staging stores) this is intentionally simple; larger future datasets require
  measurement before reuse.

## Safe Next Action

Finish the remaining isolated DEV reconciliation/recovery tests, then create a clean
Git checkpoint. Do not enable the dormant Worker adapter or connect `Tools/*` to the
Worker until browser-safe authentication is available.
