# CVS_PHANToM: Worker, D1, and Google Sheets Backend Plan

## Status

**Last updated:** `2026-09-30` (Asia/Bangkok)

This is an active backend-first plan. The current web application must continue using
Apps Script until the final frontend cutover phase is explicitly approved. Read
`Implementation Progress` before starting any task; it is the handoff source of truth
for other agents.

## Implementation Progress

| Work item | Status | Evidence / boundary |
| --- | --- | --- |
| Cloudflare tooling and account authentication | Complete | `wrangler 4.144.0` is installed and account access was verified. Do not store or commit OAuth credentials. |
| Read-only Cloudflare account check | Complete | Confirmed before any resource creation. |
| Worker DEV bootstrap (Phase 0A) | Complete | `workers/cvs-phantom-api-dev/` is deployed with only `GET /health`, no bindings, no secrets, and no frontend traffic. |
| Worker DEV local and remote health tests | Complete | Local and `workers.dev` `GET /health` returned `200`; unknown route returned `404`. |
| Phase 0 static/outbox review | Complete | Existing API, cache, Apps Script lock, local cache, and visit/noted outbox behavior recorded in `docs/PHASE_0_BASELINE_2026-09-30.md`. |
| Phase 0 single-read Sheet snapshot | Complete | Read-only counts, uniqueness, field-presence, response sizes, and successful request timing for all usable sheets recorded in the baseline document. |
| Phase 0 p50/p95, failure-rate, active-user, quota, and outbox-volume measurement | Incomplete / needs telemetry | Individual successful reads and sampling stalls are recorded; a valid 7-day observation set is unavailable. Do not make Decision Gate A yet. |
| Operational Worker API | Not implemented | Local Worker source implements only `GET /health`; all other routes return `404`. |
| Decision Gate A: Worker gateway only vs Worker plus D1 | Blocked by incomplete Phase 0 metrics | No D1 decision has been approved. |
| Phase 1 D1 foundation | Not started; D1 not created | **Do not create D1 or modify the DEV Worker beyond health without explicit next-task approval.** |
| Production frontend/App Script data path | Not started | `index.html`, `Tools/Report.html`, `Tools/ReportAdmin.html`, and deployed Apps Script remain unchanged by this backend work. |
| CVS_SME adoption | Not started | CVS_SME has active users and must not use any CVS_PHANToM Cloudflare or Sheets resource. |

### Current Safe Next Action

Continue documentation and read-only Phase 0 evidence review using the measurement
method below. Inventory available historical logs and operator observations, and record
missing metrics as unavailable / needs telemetry. Plan a 7-day observation window over
normal usage; do not claim it has been collected. Do not generate production writes,
force outbox replay, add telemetry code, or deploy changes to obtain measurements under
this documentation-only task. Any missing instrumentation needs a separately authorized
task. Update `docs/PHASE_0_BASELINE_2026-09-30.md` with sources, date range, sample
counts, limitations, and results before requesting an explicit Decision Gate A decision.
D1 foundation remains blocked until metrics are sufficient and the D1 path is approved.

### Explicit Stop Conditions

- Do not create a D1 database, Queue, Cron trigger, secret, or Apps Script bridge yet.
- Do not redirect, proxy, or shadow production frontend traffic through the Worker.
- Do not modify production Sheets or execute API mutation actions for baseline collection.
- Do not copy this work into CVS_SME until Phase 9's prerequisite is met.

## Repository and Rollout Roles

`CVS_PHANToM` is the owner-operated reference implementation and the only repository
eligible for early backend experiments, shadow reads, pilot writes, and Worker/D1
cutover testing. Its reported current use is approximately one operator; this is context, not measured
peak concurrency or evidence of future capacity. Experiments still require isolated
DEV/staging data and the applicable approvals.

`CVS_SME` is a separately deployed clone used by active users. It must remain on its
current stable production path while CVS_PHANToM work is in progress. Do not point
CVS_SME at a CVS_PHANToM Worker, D1 database, Apps Script deployment, secret, or team
data. A later adoption is a controlled clone of a proven release, with its own Cloudflare
resources and Sheets/App Script configuration.

The promotion order is fixed:

1. Build and validate in CVS_PHANToM DEV/staging.
2. Pilot CVS_PHANToM only, with reconciliation and an Apps Script fallback.
3. Freeze a tagged, verified CVS_PHANToM release after the agreed stabilization period.
4. Clone the implementation into CVS_SME with distinct deployment config, secrets,
   Worker name, Sheet bridge, and team identifier; include a separate D1 database only
   if the D1 path is approved.
5. Run CVS_SME in shadow-read/validation mode before any CVS_SME user traffic changes.
6. Enable CVS_SME gradually only after its own parity, reconciliation, and rollback checks pass.

## Goal

Support many concurrent users with fast map/list/report reads and reliable writes,
while keeping Google Sheets useful for manual editing, exports, formulas, and
operational review.

## Non-Goals

- Do not remove Google Sheets.
- Do not replace the current `index.html` or Report iframe flow early.
- Do not make Sheet and D1 unrestricted co-equal writers.
- Do not move browser-only settings, map state, GPS state, or private local history
  to the server unless a later requirement needs cross-device access.

## Current System Facts

- `index.html` calls Apps Script directly with JSONP for reads and most mutations.
- A selected Google Sheet is a team/data partition. Store IDs are only unique within
  that sheet, so the durable store key is `(sheet_name, sheet_store_id)`.
- `code.gs.txt` reads store rows from Sheets and stores per-sheet revisions in
  `PropertiesService`; its data cache is in `CacheService`.
- Route, location, visited, lastVisitedDate, and noted currently live in store rows.
- `__REPORT_CONFIG` is a separate Google Sheet tab keyed by account, kind, and item ID.
- Browser localStorage already holds place caches, `PT_GBKK_VISIT_OUTBOX_V1`,
  `PT_GBKK_NOTED_OUTBOX_V1`, Report config cache, Report history, and UI settings.
- Manual Google Sheet edits do not currently bump the Apps Script revision. A new
  change-log mechanism is required before D1 can reliably mirror manual edits.

## Current vs Target State

| Capability | Current | Target if D1 is approved |
| --- | --- | --- |
| Visit local outbox | Yes: `id`, `sheetName`, `createdAt` | Retain and add persistent idempotency key |
| Noted local outbox | Yes: latest state per `(sheetName, id)` | Retain and add persistent idempotency key |
| Route/location offline outbox | No | Not initial migration scope; online-only |
| Place local cache | Yes | Retain with Worker revision/ETag |
| Report iframe/prefill/history | Yes/browser-local | Preserve unchanged initially |
| Apps Script authentication | No | Private signed Worker bridge |
| Worker DEV scaffold | Already exists: health-only, isolated | Reuse `workers/cvs-phantom-api-dev/` |
| Operational Worker API | Not implemented | Gateway or D1-backed API selected at Decision Gate A |
| D1 | Not created | Create only after sufficient Phase 0 metrics and explicit D1 approval at Decision Gate A |
| Manual Google Sheet editing | Yes | Preserve through durable change capture |

## D1 Go / No-Go Decision

Phase 0 must measure active/peak users, p50/p95 read and write latency, Apps Script
lock/quota failures, Sheet size, request volume, offline replay volume, and the team's
ability to operate two-way sync.

| Option | Architecture | Select when |
| --- | --- | --- |
| A | Browser -> Worker -> private Apps Script -> Sheets | Gateway-only meets measured scale and latency targets |
| B | Browser -> Worker -> D1 <-> Google Sheets | Concurrent reads/writes and operational reliability justify sync complexity |

**Decision Gate A:** after Phase 0, either stop at Worker gateway plus Sheets, or
explicitly approve the D1 path. No fixed threshold is assumed before metrics exist. Record measured coverage, missing
metrics, future assumptions, approved targets, operational cost/recovery capacity,
and the rationale for A or B. Missing evidence keeps the gate pending; the scaffold
and intermittent reads do not constitute D1 approval. If A is selected, re-scope a
gateway-only implementation plan before proceeding; the D1 phases below do not apply.

## Phase 0 Measurement Method

The baseline document records historical observations separately from the following
prospective protocol. Use a proposed seven consecutive days of ordinary usage; record
actual start/end in UTC and Asia/Bangkok, device/network, action, sheet, transport,
timeout, attempts, and missing coverage. Store aggregates only in committed docs.
No production mutation calls, forced Sync/replay, cache clearing, load tests, telemetry
deployment, or resource creation are authorized for baseline collection.

| Metric | Permitted source and method | Limitation / missing evidence |
| --- | --- | --- |
| Read p50/p95 | Passive browser network observations of normal reads; optional bounded sequential `getSheets`/`getPlaces` probes only after source side-effect review. Log elapsed request-to-valid-response time per action/sheet and all outcomes. | Probe concurrency 1 measures only sequential requests; cache state unknown unless evidenced. Not user capacity. |
| Write p50/p95 | Observe writes independently initiated during ordinary owner usage using existing browser/network records; measure from submission to validated acknowledgement, including config confirmation polling. | Never initiate writes for measurement. No suitable records means unavailable/needs telemetry; server duration and offline queue wait are separate. |
| HTTP/API/timeout errors | Count each attempted request and classify transport/HTTP failure, timeout, parse failure, and API `ok:false`; error rate uses all attempts as denominator. | JSONP may hide HTTP status; record unknown. Keep retries separate and do not infer rates from incomplete runs. |
| Lock/quota failures | Read existing Apps Script execution/error records if accessible; correlate with observed API messages and observation interval. | Lock rejection can be a normal `ok:false` response; execution logs alone may miss it. Missing visibility is unavailable/needs telemetry, never zero. |
| Active/peak users | Existing access/session records if present, with anonymized distinct-user counts per Bangkok day and overlapping active sessions under an explicitly stated activity window. | No reliable identity/session telemetry demonstrated in source. One reported owner is context, not measured peak concurrency. |
| Request volume | Count existing complete network/execution records by day/action, distinguishing attempts, retries, logical operations and sampling coverage. | Single-device samples are partial; no extrapolated site totals without coverage evidence. |
| Outbox replay volume | Passive snapshots of visit/noted queue count/oldest age and existing normal replay observations, without editing localStorage or invoking Sync. | Snapshot deltas do not prove replay counts: noted entries coalesce and new items arrive. Exact attempts/successes unavailable/needs telemetry without event records. |
| Sheet/config size | Existing read-only exports or Sheets inspection for physical row/column/config counts; API response counts and bytes separately. | `getPlaces` omits rows without ID/name. API counts are not physical Sheet dimensions; avoid `getReportConfig` probes because its helper can create/unhide the config tab. |
| Reconciliation / operability | Compare read-only exports and API snapshots by sheet/ID and field presence at recorded times; document owner capacity for monitoring, retry and recovery. | Cache/revision timing may differ; parity and two-way-sync readiness cannot be inferred from presence counts alone. |

For any deliberate read probe use one in-flight request, at least 60 seconds between
requests, at most 10 requests per session, and a 60-second timeout; stop on first
error/stall without automatic retries. Normal app retries should only be observed.
Do not call a GET action safe merely because it is GET: this API also exposes mutations
through GET. Read handlers may update cache/revision metadata; do not claim zero
backend side effects.

Report sample count, successful count, failures and missing intervals per action.
Calculate successful-request percentiles by nearest rank `ceil(p * n)` on sorted
latencies; report timeouts separately rather than dropping them from reliability
statistics. Fewer than 100 successes per action is descriptive only for this plan;
even 100 does not establish representativeness. Never pool different actions,
transports, sheets, or known cache states into an unexplained percentile.

### Current Load vs Future Workload Assumptions

Current evidence is the historical 674 returned places across three sheets, one
successful read timing per sheet, and reported single-owner usage. Daily request
volume, measured peak users, concurrent requests and write/replay distributions are
unknown. Sequential probe concurrency 1 is a sampling constraint only.

Future peak users, request concurrency, read/write mix, data growth, offline bursts,
p95 targets and acceptable sync lag are **TBD assumptions**, to be agreed and tested
in isolated staging. CVS_SME demand is separate and not inferred from CVS_PHANToM.
Single-owner measurements alone cannot validate a many-user target or justify D1.

## Target Architecture

The following is a proposed D1-path design, not implemented behavior. All D1 schema,
sync, outbox, ownership, and D1-specific authentication details below are conditional on
sufficient Phase 0 metrics and explicit D1 approval at Decision Gate A. If gateway-only
is selected, revise this design and the remaining phases before implementation; do not
create D1 to support a gateway-only choice.

```text
Browser
  | standard HTTPS JSON API
  v
Cloudflare Worker
  |---- D1: low-latency operational reads/writes (D1 path only)
  |---- Worker outbox: retryable projection jobs
  v
Private signed Apps Script bridge
  v
Google Sheets: manual administration, exports, formulas, and mirror

Google Sheets manual edit
  -> Apps Script onEdit/change log
  -> Worker sync endpoint or scheduled pull
  -> D1
```

This diagram and the D1-specific design sections below are proposed Option B only,
not current behavior or authorization. Option A retains Sheets as the operational
store and requires no D1 mirror/outbox.

After an approved cutover, the Worker is the only public API. Apps Script becomes a private bridge trusted only
by the Worker. D1 is the web application's operational database after cutover. Sheets
remain the human-friendly administration and reporting surface.

## Data Ownership

| Field | Primary authority after cutover | Sheet behavior | Version scope |
| --- | --- | --- | --- |
| Store name, account, account_name, branch number, maps URL | Google Sheets | Manual edit syncs to D1 | `masterVersion` |
| Route | D1 operational value | Manual Sheet edit is explicit admin override | `routeVersion` |
| Location | D1 operational value | Manual Sheet edit is explicit admin override | `locationVersion` |
| Visited, lastVisitedDate | D1 | Project current state back to Sheet | visit-state version |
| Noted/report state | D1 | Project latest snapshot back to Sheet | noted version |
| Report config | Google Sheets initially; D1 read model after validation | Account config-set sync increments version | config-set version |
| Report copy history | Browser | No sync initially | N/A |
| Browser cache/outbox/settings | Browser | Retain unchanged | N/A |

Route/location are not broad dual authority. D1 owns normal application operations;
a direct Sheet edit is an intentional `sheet_manual` admin override that becomes the
next D1 value under the relevant field-specific conflict rule.

## Conflict Rules

1. Store rows use `master_version`, `route_version`, and `location_version`, plus
   `updated_at`, `updated_by`, and `sync_origin`.
2. General Sheet master changes use `baseMasterVersion`; route PATCH uses
   `baseRouteVersion`; location PATCH uses `baseLocationVersion`.
3. Route and location may merge because they have independent versions.
4. A same-field version mismatch returns `409 Conflict`; the client reloads the latest
   value instead of silently overwriting it.
5. A manual Sheet edit is an admin override for master fields. Its change-log event
   contains the sheet row, column, value, editor/origin when available, and timestamp.
6. Worker-to-Sheet projection tags its own origin so the Sheets onEdit path does not
   create a sync loop.
7. Reconciliation jobs compare source versions/counts and raise an explicit error;
   they never silently choose an arbitrary winner.

## Proposed D1 Schema

```sql
teams (
  id TEXT PRIMARY KEY,
  sheet_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  source_revision TEXT,
  synced_at TEXT
)

stores (
  team_id TEXT NOT NULL,
  sheet_store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  account TEXT,
  branch_number TEXT,
  account_name TEXT,
  route TEXT,
  latitude REAL,
  longitude REAL,
  maps_url TEXT,
  master_version INTEGER NOT NULL DEFAULT 1,
  route_version INTEGER NOT NULL DEFAULT 1,
  location_version INTEGER NOT NULL DEFAULT 1,
  source_active INTEGER NOT NULL DEFAULT 1,
  source_deleted_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  sync_origin TEXT NOT NULL,
  PRIMARY KEY(team_id, sheet_store_id)
)

visit_state (
  team_id TEXT NOT NULL,
  sheet_store_id TEXT NOT NULL,
  visited INTEGER NOT NULL DEFAULT 0,
  last_visited_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY(team_id, sheet_store_id)
)

visit_events (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  sheet_store_id TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
)

store_noted (
  team_id TEXT NOT NULL,
  sheet_store_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY(team_id, sheet_store_id)
)

report_config_sets (
  account TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
)

report_config (
  account TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account, kind, item_id)
)

api_idempotency (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  status_code INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, idempotency_key)
)

sync_outbox (
  id TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
)

sheet_change_log (
  event_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  sheet_row INTEGER,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  changed_fields_json TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL,
  status TEXT NOT NULL,
  processed_at TEXT
)
```

Required indexes: `stores(team_id, source_active, route)`, `stores(team_id, account)`,
`visit_state(team_id, visited)`, `sync_outbox(status, next_retry_at)`, and
`sheet_change_log(status, source_updated_at)`.

Sheet row deletion is soft deletion: removed row -> `source_active=0` and
`source_deleted_at` set. Normal store lists omit inactive stores; audit/history remains.
Restoring the Sheet row reactivates the same `(team_id, sheet_store_id)`. Hard delete is
an explicit admin maintenance operation only.

Bulk Report config replace must atomically replace that account's config rows and
increment `report_config_sets.version`; `GET /v1/report-config/:account` returns the
set-level version plus items so existing Report config cache/version behavior is preserved.

## Worker API Contract

All mutation endpoints use JSON over HTTPS, authenticated sessions, server-side
validation, an `Idempotency-Key` header, and a field-specific `baseVersion`. No
mutation uses JSONP or GET.

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/teams` | user | Teams available to the user |
| GET | `/v1/teams/:teamId/stores` | user | Stores, route filter, revision/ETag |
| POST | `/v1/teams/:teamId/stores/:storeId/visits` | user | Mark visited |
| POST | `/v1/teams/:teamId/visits/reset` | admin | Reset team visits |
| PATCH | `/v1/teams/:teamId/stores/:storeId/route` | permitted user | Change route |
| PATCH | `/v1/teams/:teamId/stores/:storeId/location` | permitted user | Change location |
| PUT | `/v1/teams/:teamId/stores/:storeId/noted` | user | Save current Report state |
| GET | `/v1/report-config/:account` | user | Report catalog and version |
| PUT | `/v1/report-config/:account` | admin | Replace validated config batch |
| POST | `/internal/sync/sheets` | worker/admin only | Sync/reconcile control |

Example route request:

```json
{ "value": "7", "baseVersion": 12 }
```

```text
Idempotency-Key: persistent-client-operation-id
```

Success returns `{ ok, version, updatedAt }`. A field conflict is HTTP `409` with
`currentVersion` and `currentValue`. The same actor/key/request hash returns the saved
original response; the same actor/key with another payload is rejected. This applies to
visit, noted, route, location, config mutations, and destructive admin operations.

## Atomic D1 Mutation and Outbox Rule

Every D1 mutation that must project to Sheets uses one atomic transaction/batch:

```text
validate authorization, idempotency, and version
-> mutate operational state
-> write event/audit when applicable
-> insert sync_outbox
-> store api_idempotency response
-> commit all or none
```

Examples: `visit_state + visit_events + sync_outbox`, `store_noted + sync_outbox`, or
`stores.route + sync_outbox`. A D1 update must not commit when its outbox insert fails.

## Authentication and Authorization

1. Prefer Cloudflare Access with approved Google identities if the production domain
   can be placed behind Cloudflare.
2. The Worker verifies identity and maps it to `user` or `admin` plus team permissions.
3. If Access is not suitable, design Worker-managed device login and signed sessions
   (D1 storage only for Option B; choose storage separately for Option A); do not put a shared write password in frontend code.
4. The Apps Script bridge validates a Worker-held secret and rejects public mutation
   calls. The secret is stored as a Worker secret and Apps Script property, never in
   `index.html`.

## Worker to Apps Script Security

Apps Script is a private bridge, not an assumed REST backend. Worker requests contain
`timestamp`, `nonce`, `body hash`, and
`HMAC-SHA256(secret, timestamp + nonce + bodyHash)`. Apps Script validates the
allow-listed action, signature, timestamp tolerance, and replayed nonce when required.
The browser never receives the secret.

## Browser Offline Strategy

Initial scope remains intentionally narrow:

- Visit and noted remain offline-capable.
- Route and location remain online-only; no new route/location outbox in this migration.
- Before Worker writes are enabled, browser outbox records migrate to a
  destination-neutral format containing `id`, `teamId`, payload/state, `createdAt`, and
  a persistent `idempotencyKey`.
- The key is created once at queue time and reused after refresh, close/reopen, retry,
  or backend feature-flag change.

## D1 Outbox Processing Model

```text
D1 atomic mutation -> sync_outbox -> Cloudflare Cron -> processor
  -> private Apps Script bridge -> Google Sheets
```

The processor selects due pending jobs in batches of 20-50, projects idempotently,
marks success completed, and uses attempts plus exponential backoff on failure.
Repeated failures move to a visible error/dead-letter state with manual admin retry.
Cloudflare Queues is a future optimization only if D1/Cron cannot meet measured needs.

## Sheets to D1 Change Capture

- Add an installed Apps Script `onEdit` path and durable `__SYNC_EVENTS`/change-log tab.
- A manual edit records sheet, row, store ID, changed field/value, source time, and
  `sync_origin=sheet_manual`.
- Worker pulls pending events on a schedule or receives a signed notification, applies
  ownership/version rules, and acknowledges processed events.
- Some bulk/import/API edit types may not reliably invoke `onEdit`; reconciliation is
  the required fallback and this limitation must be documented during implementation.
- Metadata may use a dedicated admin/hidden tab when visible columns would disrupt work.

## Sync Loop Prevention

Supported origins are `sheet_manual`, `worker_api`, `worker_projection`, `migration`,
and `reconciliation`. Worker-to-Sheet projection must include an operation marker that
the bridge detects, so it never becomes another inbound manual event. If write origin
cannot be detected reliably, use the projection operation ID with short-lived bridge
suppression. Only genuine manual edits create `sheet_manual` events.

## Reconciliation

Scheduled reconciliation detects, reports, and routes repair; it must not blindly
choose a winner. It checks store count, active IDs, route/location hashes, visit and
noted mismatches, Report config-set versions, failed outbox jobs, and unprocessed Sheet
events. Output status is `healthy`, `warning`, or `error` with team/entity/field detail.

## Timezone Rules

- Server/audit timestamps (`created_at`, `updated_at`, `occurred_at`) are UTC ISO 8601.
- Business dates (`last_visited_date`, report date) resolve in `Asia/Bangkok`.
- Never derive Bangkok business date from a UTC calendar date directly. For example,
  `2026-09-30T17:30:00Z` is `2026-10-01` for Bangkok business date purposes.

## Backend-First Migration Phases

Phase 0 metrics remain incomplete; Phase 0A bootstrap is already complete. Phases 1–9
below describe the conditional D1 rollout and have not started. They are not approval
to provision resources or change production. A gateway-only decision requires a revised
implementation plan instead of proceeding through the D1 phases.

### Phase 0: Baseline and Safety

- **Objective:** collect baselines and make Decision Gate A.
- **Allowed changes:** export/measurement/documentation only; no production data path change.
- Export Sheets and capture row counts, IDs, route/location/visited/noted samples.
- Document latency, lock/quota errors, active sheets, current outbox formats, and usage volume.
- **Integrity/acceptance:** repeatable comparison report and explicit Worker-only versus D1 decision.
- **Rollback/recovery:** none required because production behavior is unchanged.

### Phase 0A: Isolated Worker DEV Bootstrap — Complete

- Existing project: `workers/cvs-phantom-api-dev/`, with `wrangler.jsonc`, development
  configuration, observability enabled, and `GET /health` only.
- Local/remote health `200` and unknown-route `404` are recorded in the dated baseline;
  remote deployment was not rechecked during this documentation review.
- No operational API, D1 database, bindings, secrets, or frontend traffic integration.
- **Integrity/acceptance:** health-only scaffold exists; this does not complete Phase 0 metrics.
- **Rollback/recovery:** production has no dependency on this isolated scaffold.

### Phase 1: Conditional D1 Foundation — Not Started

- **Entry gate:** sufficient Phase 0 metrics and explicit Decision Gate A approval of
  the D1 path, followed by explicit authorization for the implementation task. Until
  then, do not create D1, bindings, secrets, migrations, or expand the health-only Worker.
- Reuse the existing Worker DEV project; only after approval create a D1 database,
  schema/forward migrations and required environment-specific bindings, and extend logs.
- Create schema only; do not point frontend traffic to it.
- **Integrity/acceptance:** forward migrations plus recovery/restore procedures for
  destructive changes are tested in development and staging; do not assume automatic rollback.
- **Rollback/recovery:** restore/rebuild staging D1; production remains untouched.

### Phase 2: Secure Apps Script Bridge

- Add private bridge actions for bulk snapshot export, change-log read/acknowledge, and
  idempotent Sheet projection.
- Add a Sheets `__SYNC_EVENTS` log and installed onEdit trigger for manual edits.
- Add origin/version metadata columns or a metadata tab without disturbing visible
  operational columns.
- **Integrity/acceptance:** manual edit produces one durable event; Worker projection
  does not loop back as a new user edit; signed bridge rejects invalid/replayed requests.
- **Rollback/recovery:** disable bridge trigger/endpoints; Sheets remain authoritative.

### Phase 3: Initial Import and Shadow Mirror

- Import every usable sheet, store row, report config, visit state, and noted payload into D1.
- Store `(team_id, sheet_store_id)` identities; never generate replacements for Sheet IDs.
- Run scheduled and manual Sheets-to-D1 sync while production still reads Apps Script.
- **Integrity/acceptance:** per-team count, IDs, active state, route, location, visited,
  noted, and config-set versions match.
- **Rollback/recovery:** discard/rebuild mirror; production still reads Apps Script.

### Phase 4: D1-to-Sheet Projection Outbox

- Implement Worker-side outbox processing, retry with backoff, idempotency, dead-letter
  visibility, and reconciliation jobs.
- Exercise synthetic D1 writes in staging and verify Sheets receive exactly one result.
- **Integrity/acceptance:** atomic mutation never lacks an outbox record; interrupted sync
  resumes, duplicate delivery is harmless, and failures are visible.
- **Rollback/recovery:** stop processor and retain D1/outbox records for later retry.

### Phase 5: Read-Only Backend Validation

- Add Worker read endpoints and compare their responses with Apps Script in shadow mode.
- Add ETag/revision responses and query indexes for team/route/account.
- Do not change `index.html`; use a private test client or staging environment.
- **Integrity/acceptance:** sustained-load benchmark meets approved target latency and
  data comparison remains clean.
- **Rollback/recovery:** disable Worker reads; Apps Script remains live.

### Phase 6: Operational Write Validation

- Enable Worker writes for test users only: visit, noted, route, location, then config.
- Migrate visit/noted outbox records with persistent idempotency keys before changing their destination.
- Verify D1 transaction, Worker outbox, Sheet projection, conflict behavior, and offline replay.
- **Integrity/acceptance:** no lost visit/noted writes during forced interruption or concurrency;
  route/location remain online-only.
- **Rollback/recovery:** pause pilot writes, reconcile pending projections and duplicate
  handling, then return writes to Apps Script; retain D1 outbox for recovery.

### Phase 7: Frontend Integration Last

- Introduce a small API adapter in `index.html`, guarded by `API_BACKEND=apps-script|worker`.
- Preserve map, Report iframe, local cache, local history, prefill, and UI behavior.
- Migrate reads first, then mutations one endpoint at a time with per-team feature flags.
- Update ReportAdmin only after its Worker config API has passed staging validation.
- **Integrity/acceptance:** flags are reversible; write fallback is enabled only after
  pending projections and duplicate handling are reconciled.
- **Rollback/recovery:** change only affected read/write flags; do not delete pending outboxes.

### Phase 8: Controlled Cutover and Operations

- Enable Worker/D1 per team, monitor sync lag/error rate/conflicts, then expand rollout.
- Keep Apps Script fallback for an agreed stabilization period.
- Retire public Apps Script mutation endpoints only after all active clients use Worker.
- **Integrity/acceptance:** reconciliation stays healthy through the agreed stabilization period.
- **Rollback/recovery:** pause affected writes, reconcile pending D1 projections before
  routing writes to Apps Script, and switch affected team flags only when fallback
  data is current. Retain D1/outbox records; rehearse recovery before cutover.

### Phase 9: CVS_SME Clone and Separate Rollout

- Start only after CVS_PHANToM has completed its stabilization period and a tagged
  reference release is approved.
- Copy source and migrations, but provision independent CVS_SME Worker DEV/staging/
  production names, D1 databases, HMAC secrets, Apps Script bridge configuration,
  Google Sheet IDs, and `team_id` values. Never reuse CVS_PHANToM operational data.
- Begin with read-only parity checks and shadow reads for CVS_SME. Existing CVS_SME users
  remain on its current Apps Script path until the CVS_SME-specific decision gate passes.
- **Integrity/acceptance:** CVS_SME reconciliation, conflict behavior, offline replay,
  and rollback have been demonstrated against CVS_SME's own data.
- **Rollback/recovery:** switch CVS_SME feature flags back to its existing Apps Script
  path; keep its D1 data and sync outbox for diagnosis and replay. CVS_PHANToM remains
  unaffected.

## Rollback Rules

- `READ_BACKEND=apps-script|worker` switches store/config reads.
- `WRITE_BACKEND=apps-script|worker` switches each mutation class independently.
- Browser outboxes retain destination-neutral payloads and persistent idempotency keys
  after their Phase 6/7 format migration.
- Rollback never deletes D1, Sheet data, outboxes, or sync logs.
- Before switching write authority, pause affected writes and reconcile pending jobs;
  a flag alone cannot prevent stale Sheet reads, duplicates, or lost updates. Preserve
  a tested authenticated fallback before retiring public Apps Script mutations.
- If D1 read is stale, return reads to Apps Script only after verifying Sheet freshness;
  if Sheet projection fails, keep the
  D1 write and retry from `sync_outbox` rather than asking users to repeat their work.

## Test Plan

1. Import parity: each team and store ID matches Sheet.
2. Route filtering and map data match under both read backends.
3. Offline visit/note survives refresh, close/reopen, and reconnect.
4. Route/location remain explicitly online-only during the initial migration.
5. Duplicate clicks and duplicate outbox replay create one mutation only.
6. Two devices edit the same route/location/note; verify field-specific conflict policy.
7. Manual Sheet edit reaches D1; Worker projection does not create a loop.
8. Sheet row removal soft-deletes and restoration reactivates without losing history.
9. Report prefill, Save, Copy, Copy to LINE, config versioning, and disabled items remain unchanged.
10. Load test concurrent reads/writes and inspect p95 latency, error rate, queue lag, and D1/Sheet parity.

## Observability

Minimum operational signals: Worker request rate/latency/error, authorization failures,
D1 errors, idempotency hits/mismatches, pending/failed outbox age, bridge signature
failures, Sheet change-log lag, reconciliation state, and per-team parity mismatches.

## Future File Impact

These are future implementation impacts, not changes authorized by this documentation task.

- `workers/cvs-phantom-api-dev/` (existing health-only scaffold): future API/auth work;
  D1 queries, sync jobs, migrations, and associated tests only if D1 is approved.
- `code.gs.txt`: private bridge, onEdit/change log, secure projection endpoints.
- `index.html`: final API adapter and feature flags only; no UI redesign required.
- `Tools/Report.html`: retain iframe/prefill; only transport responsibility remains with parent.
- `Tools/ReportAdmin.html`: swap transport to Worker after backend validation.

`Tools/Mjob_Helper.html` and `Tools/Timestamp.html` are outside this migration scope.

## Decisions Required Before Implementation

1. Is a Cloudflare-managed domain available for Cloudflare Access?
2. Which users may edit route/location, and which are admin-only?
3. What maximum acceptable Sheet-to-D1 sync delay is acceptable for manual edits?
4. Should conflict resolution block users with `409`, or allow last-write-wins for any field?
5. Is cross-device Report history required, or should it remain browser-local?
6. What are target peak concurrent users and p95 read/write latency targets?

## Final Recommended Roadmap

Start with metrics, not infrastructure. Decision Gate A chooses Worker-only gateway or
the D1 path. If D1 is justified, finish identity/versioning, signed bridge, Sheet change
capture, shadow mirror, atomic outbox, reconciliation, and pilot validation before any
frontend integration. The existing UI connects last through reversible feature flags.
