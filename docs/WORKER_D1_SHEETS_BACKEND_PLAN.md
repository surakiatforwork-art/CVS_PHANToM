# CVS_PHANToM: Worker, D1, and Google Sheets Backend Plan

## Status

**Last updated:** `2026-10-01` (Asia/Bangkok)

This plan now records an owner-authorized production cutover performed on
`2026-10-01`. The historical Phase 0 / Decision Gate A measurements remain incomplete,
but the owner explicitly approved moving CVS_PHANToM to the verified Worker/D1 path
while all users were stopped for the cutover. Read `Implementation Progress` and
`docs/BACKEND_DEV_PROGRESS_2026-09-30.md` before making further changes.

## Implementation Progress

| Work item | Status | Evidence / boundary |
| --- | --- | --- |
| Cloudflare tooling and account authentication | Complete | `wrangler 4.144.0` authenticated against the approved account. Credentials stay outside Git. |
| Worker operational API | Production cutover deployed | Worker `cvs-phantom-api-dev` is operationally serving production data despite its historical `-dev` name. Current deployed version after auth/retry hardening: `c13b8796-7e0a-45cb-af3a-aee296d77528`. |
| D1 foundation | Production data loaded / migrations reproducible | `cvs-phantom-db-dev` contains production CVS_PHANToM data. Migrations `0001` through `0004_auth_rate_limit.sql` apply cleanly to a fresh local D1 and are applied remotely. |
| Apps Script bridge | Production Sheet target verified | Signed bridge reads the production `CVS_PHANToM` spreadsheet. A complete production snapshot returned 3 teams, 674 stores, 8 config accounts and 505 config items. |
| Sheet -> D1 reconciliation | Production enabled | Worker Cron runs every 5 minutes; every 15 minutes it pulls a complete signed Sheet snapshot. Snapshot reads retry up to 3 times to tolerate transient Apps Script non-JSON responses. |
| Production parity/count check | Passed before frontend push | DB_GBKK4 120/96 visited, DB_GBKK2 364/62 visited, SME_CVS20 190/0 visited; Worker/D1 counts match the production Google Sheet. |
| Browser authentication | Implemented / verified | User/admin access codes remain Worker secrets. Browser receives a signed 12-hour session token only, stored in `sessionStorage`. Login attempts are rate-limited by HMAC-hashed client IP. |
| Report Admin | Worker path enabled | Admin role is required for report-config writes. A no-op LAWSON production write was verified end-to-end with stable version and completed outbox projection. |
| Report config reads | Worker path enabled | Report and main-page config warm-up read from Worker/D1 in Worker mode, so admin changes are visible immediately from D1 while Sheet projection remains asynchronous. |
| Legacy fallback | Retained | `?backend=legacy` keeps the Apps Script path available for emergency rollback. |
| Phase 0 historical workload measurement | Incomplete | Original p50/p95, error-rate, active-user and quota evidence remains incomplete; this is documented rather than rewritten as complete. |
| CVS_SME adoption | Not started / isolated | The separately deployed CVS_SME app/resources were not modified. |

### Current Safe Next Action

Finish the frontend commit/push and verify the Vercel deployment at
`https://sme-cvse20.vercel.app` with user and admin sessions. Then monitor Worker
health, outbox errors/dead rows and Sheet reconciliation during the first live usage
window.

### Production Safety Boundaries

- Keep Worker session/access secrets out of Git and browser source.
- Distribute only the user access code to normal users; keep the admin code private.
- Preserve `?backend=legacy` as the immediate rollback path during stabilization.
- Do not modify or connect the separately deployed CVS_SME resources.
- Do not force-push or discard the backend checkpoint/history.

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
| Apps Script authentication | DEV bridge uses private signed Worker requests; production path still unauthenticated legacy Apps Script | Production bridge must retain server-only signed authentication |
| Worker DEV scaffold and gateway | D1-backed DEV API and bridge are deployed and E2E-tested on staging; frontend not connected | Keep isolated until release gate and frontend integration approval |
| Production-ready operational Worker API | Not yet; current DEV API still uses a shared DEV bearer token | Add production identity/role authorization and rollout controls before frontend cutover |
| D1 | Created in isolated DEV only; migrations 0001-0003 applied | Treat as technical experiment until Decision Gate A is formally resolved |
| Manual Google Sheet editing | Yes; staging reconciliation path implemented with Worker Cron pull | Preserve manual editing with versioned reconciliation and recovery checks |

## D1 Go / No-Go Decision

Phase 0 must measure active/peak users, p50/p95 read and write latency, Apps Script
lock/quota failures, Sheet size, request volume, offline replay volume, and the team's
ability to operate two-way sync.

| Option | Architecture | Select when |
| --- | --- | --- |
| A | Browser -> Worker -> private Apps Script -> Sheets | Gateway-only meets measured scale and latency targets |
| B | Browser -> Worker -> D1 <-> Google Sheets | Concurrent reads/writes and operational reliability justify sync complexity |

**Decision Gate A:** after Phase 0, either select Worker gateway plus Sheets or
explicitly approve the D1 path for production. No fixed threshold is assumed before
metrics exist. Record measured coverage, missing metrics, future assumptions, approved
targets, operational cost/recovery capacity, and the rationale for A or B.

An isolated D1 DEV experiment now exists and has passing staging integration evidence.
This is a technical experiment only and does **not** retroactively approve Option B for
production. Missing production workload evidence keeps the formal gate pending. If A
is ultimately selected, the DEV D1 experiment is retired or retained only as test
evidence and the production plan is re-scoped to gateway-only.

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
| Reconciliation / data validity | Compare read-only exports and API snapshots by sheet/ID at aligned times; record count/state differences and explicit route/location validity rules. | Cache/revision timing and intervening normal edits may differ; presence counts alone do not establish validity or parity. |
| Two-way sync operating readiness | Isolated staging sync now exists: D1->Sheet outbox is E2E-tested and Worker Cron Sheet->D1 pull is deployed. Document owner review of alert ownership, conflict handling, retries, reconciliation, restore responsibilities, operating time budget, and acceptable sync lag. | Technical path exists, but scheduled-pull observation, deliberate manual-edit reconciliation, controlled failure recovery, and production operating ownership remain incomplete. |

For any deliberate read probe use one in-flight request, at least 60 seconds between
requests, at most 10 requests per session, and a 60-second timeout; stop on first
error/stall without automatic retries. Normal app retries should only be observed.
Do not call a GET action safe merely because it is GET: this API also exposes mutations
through GET. Read handlers may update cache/revision metadata; do not claim zero
backend side effects.

Report sample count, successful count, failures and missing intervals per action.
Calculate successful-request percentiles by nearest rank `ceil(p * n)` on sorted
latencies; report timeouts separately rather than dropping them from reliability
statistics. Sample sufficiency must be reviewed against coverage and the agreed
future workload; neither a fixed sample count nor seven elapsed days establishes
representativeness or satisfies Gate A. Never pool different actions,
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

## Phase 0 Detailed Measurement Matrix

This matrix is the source-confirmed collection design. It supplements the compact
measurement table above. "Passive" means observing normal user actions or existing
logs only; it never means generating a visit, note, route, location, reset, Sync,
cache clear, or load-test request to produce a sample.

| Metric | Source already available | What can be measured now | Unavailable / needs telemetry | Passive collection method | Sample / aggregation method | Risk or limitation | Needs telemetry? | Smallest telemetry proposal (design only) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Read latency p50/p95 | Browser Network/DevTools for normal JSONP reads; Apps Script responses; historical baseline | Individual elapsed samples for `getSheets`, `getPlaces`, config meta/config when a user naturally opens them | Complete population p50/p95 across devices and cache states | Record normal request start-to-valid-response time, action, sheet, transport, cache hint, and outcome | Keep actions/sheets/cache states separate; nearest-rank p50/p95 on successful samples; report timeouts separately | JSONP obscures some HTTP detail; browser timing is device/network-specific | Yes for representative population; No for a manual local sample | One client event after each completed read: action, sheet pseudonym, start/end duration, outcome, cache hint, retry/operation IDs; no payload/store data |
| Write latency p50/p95 | Normal UI requests for visit, note, route, location, report config; Apps Script response | A normal user operation can be timed from submit to API acknowledgement; ReportAdmin confirmation polling can be observed separately | Representative write latency, queue delay, and acknowledgement-to-durable-confirmation distribution | Observe naturally occurring actions only; record client submit, each attempt, acknowledgement, and final visible confirmation | Aggregate separately by mutation action; report direct write, queued wait, and confirmation polling as different durations | Acknowledgement does not prove future cross-system durability; no writes may occur in a window | Yes | One completion event per logical user operation with action, operation ID, attempts, queue delay, acknowledgement/final-confirmation times, and sanitized outcome code |
| HTTP/API errors and timeout rate | Browser Network/console, JSONP callbacks/errors, existing Apps Script execution view if accessible | Errors seen on the observed device; API `ok:false`; callback/script errors; manually observed timeouts | Fleet-wide HTTP status mix and error denominator | Record every observed attempt and classify HTTP when known, JSONP/script error, parse error, API error, timeout, or cancelled observation | Error rate = failed attempts / all attempts, by action and source; show unknown HTTP status separately | JSONP can hide status and retries distort rate if not labeled | Yes | Reuse the minimal request completion event with `outcomeClass`, status when known, timeout flag, and attempt number |
| Apps Script lock failures | `code.gs.txt` returns an `ok:false` message after 1-second lock acquisition failure for visit/note/route/location; 5 seconds for bulk config | Static lock windows and any observed matching API error | Actual lock-failure count/rate and lock wait time | Correlate normal observed API responses with Apps Script execution/error records where available | Count lock failures per mutation action and per logical operation; retain retries as attempts | Error text may change; execution dashboard may not expose a structured reason | Yes | Emit a sanitized server-side counter/event only for lock result, action, elapsed lock wait bucket, and timestamp; no row IDs/payloads |
| Apps Script quota/execution failures | Apps Script execution/error dashboard if owner access exists; browser failure observations | Historical/dashboard failures visible to the owner | Quota category, per-action failure rate, and complete execution duration distribution | Export or manually inspect existing execution/error records over the observation window | Count by documented failure category and day; record unknown when only a client error exists | Dashboard retention/detail may be insufficient; no source-level quota counter exists | Yes if dashboard evidence is insufficient | Minimal server event with action, completion class (`success`, `lock`, `quota`, `exception`), duration, and request/operation ID hash |
| Active users | No authentication or durable session counter in source; operator observation only | Reported owner/operator context | Daily active users or distinct users | If existing access/session records exist, count anonymized distinct users; otherwise record unavailable | Daily distinct rotating pseudonyms, with source coverage stated | Browser/device identifiers can over- or under-count people; no current source proves identity | Yes | Privacy-preserving rotating daily client pseudonym with no account, store, GPS, note, or device fingerprint fields |
| Peak concurrent users / concurrent requests | No concurrency metric in browser or Apps Script source | None beyond isolated observation of one device | Peak users, peak in-flight requests, and burst profile | Existing execution records may show overlapping timestamps if they contain sufficient detail; otherwise unavailable | Maximum overlapping request intervals per action/day; separately state user concurrency versus request concurrency | Execution timestamps may be coarse; one device cannot represent total concurrency | Yes | Request lifecycle events with timestamp and short-lived request ID; derive overlap off-device without retaining user content |
| Daily request volume by action | Browser API wrappers name actions; Apps Script `doGet` routes actions | Local/manual count for a sampled device only | Complete daily production volume by action and retry rate | Count passive observed requests and distinguish action, attempt, and logical operation | Daily counts: logical operations, attempts, retries, successes, failures, unknown coverage | Apps Script execution count alone may not retain action; JSONP retries otherwise look like new requests | Yes | One lightweight request event with action, operation ID, attempt number, and outcome; aggregate daily before export |
| Visit outbox replay volume | `PT_GBKK_VISIT_OUTBOX_V1`; boot/online/manual Sync calls `syncVisitOutbox_` | Current queue count and pending item age on one browser; normal sync behavior can be observed | Exact attempts, successful removals, failures, and fleet replay volume | Passive localStorage/DevTools snapshot before/after naturally occurring sync; do not click Sync for measurement | Per-device backlog count/oldest age; only call a replay observed when the same pending item disappears after a normal sync | Queue entries coalesce only by visit key; snapshots cannot prove why an entry changed | Yes for replay volume; No for a one-device backlog snapshot | Emit aggregate visit-outbox attempt/result events using operation ID hash and queue-size/age buckets; omit place ID |
| Noted outbox replay volume | `PT_GBKK_NOTED_OUTBOX_V1`; `readNotedOutbox_` keeps latest state per `(sheetName, id)` | Current queue count/age on one browser and normal sync observation | Exact write supersession, replay success/failure, and fleet volume | Passive localStorage/DevTools snapshot before/after normal replay | Record latest-state queue count and age; do not infer item creation count from queue size | Later note replaces earlier state; queue delta is not a count of user edits | Yes for replay volume; No for a one-device backlog snapshot | Emit aggregate note-outbox attempt/result and superseded-state counter; never send noted JSON, store ID, or report content |
| Outbox backlog / oldest pending age | Both local outbox records include `createdAt`; Sync button exposes combined count | Per-device visit/note count and oldest pending age without mutation | Global backlog, age distribution, and reason an item remains pending | Read localStorage passively or record the visible pending count during normal use | Snapshot by local day: queue type, count, oldest-age bucket, observation time; do not edit storage | Clock skew and stale tabs affect age; backlog is browser-local | Yes for fleet aggregate; No for a local snapshot | Periodic low-frequency aggregate heartbeat only while app is open: queue counts and oldest-age buckets, no payload/IDs |
| Google Sheet row/column size | Google Sheets UI/read-only export; `getLastRow()`/`getLastColumn()` in source | Physical dimensions when owner inspects Sheets; API returned place count and response bytes | Historical growth rate without repeated inspection | Manual read-only sheet inspection or existing export metadata | Per sheet: physical rows, columns, usable rows, timestamp; keep API place count separate | `getPlaces` omits rows lacking ID/name; no generic read API exposes physical dimensions | No | None initially; a later read-only inventory endpoint is optional only after separate approval |
| Report config size | `__REPORT_CONFIG` Sheet tab and its known columns; ReportAdmin loaded items | Physical rows/columns and account/kind counts through read-only Sheet inspection | Complete config size/growth history if no snapshots exist | Inspect Sheet UI/export only; do not call helper paths that can create/unhide the tab | Per account/kind: active/inactive item count and serialized data byte total if export provides it | `getReportConfigSheet_()` can insert/unhide a tab, so it is not a safe generic probe | No | None initially; optional later inventory should be read-only and must not create/unhide sheets |
| Response payload size | Browser Network transfer/body size; baseline JSONP body bytes | Individual `getPlaces`/`getSheets` response size for observed normal loads | Fleet payload distribution and compression/transfer details when browser omits them | Record Network body/transfer bytes from natural reads | p50/p95/max bytes by action/sheet and known cache state | JSONP and redirects can obscure transfer size; body bytes differ from compressed bytes | No for manual sample; Yes for fleet distribution | Add response byte count to the same minimal read completion event, never the response body |
| Reconciliation / data-validity signals | Sheet UI/export; `getPlaces` response fields (`id`, route, lat/lng, visited, noted, revision); baseline uniqueness/presence checks | Point-in-time per-sheet returned count, duplicate IDs, field presence, route/coordinate validity rules, and API-versus-export comparison | Automatic change capture, full history, cross-system parity, and alerting | Aligned read-only Sheet export and API snapshot; compare only documented fields/rules | Record timestamp, source revision/cache state, counts, duplicate IDs, invalid coordinates/routes, and mismatches by field | Manual Sheet edits do not bump revision; cache and normal edits can make snapshots non-atomic | No for manual point-in-time comparison; Yes for continuous reconciliation | Future minimal reconciler emits aggregate mismatch counts and revisions only; do not copy store names, notes, or coordinates |

### Source-Confirmed Constraints

- `index.html` uses JSONP reads and retries some reads, so an attempt and a logical user
  operation are different units.
- `VISIT_OUTBOX_KEY` and `NOTED_OUTBOX_KEY` are browser-local. The noted outbox keeps
  only the latest state for a store, so backlog size cannot be treated as edit volume.
- `code.gs.txt` exposes mutations through `GET`; never infer a request is read-only from
  its HTTP method alone.
- `api_getPlaces_()` reads Sheet rows and uses `CacheService` with a 300-second TTL.
  It returns only rows that have both an ID and a name.
- `getReportConfigSheet_()` can create or unhide `__REPORT_CONFIG`; therefore report
  configuration inspection must use the Google Sheet directly during Phase 0.

## Seven-Day Observation Protocol

This protocol is a design for a separately authorized observation run. It does not
authorize instrumentation, production writes, forced Sync/replay, cache clearing,
resource creation, deployment, or load testing.

### Time Window and Coverage

1. Before the run, record `start_utc` in ISO 8601, `start_bangkok` in
   `Asia/Bangkok`, the planned `end_utc`, and the planned `end_bangkok`. The end is
   seven consecutive Bangkok calendar days after the start.
2. At completion, record actual UTC and Bangkok start/end timestamps, observation
   devices/networks, missing intervals, data sources, and whether normal use occurred.
3. Seven elapsed days alone is insufficient. Coverage must include the normal operating
   periods and every action that actually occurred; metrics with no valid source remain
   `Unavailable / Needs telemetry`.

### Per-Request Observation Record

For an observed normal request, record only:

| Field | Rule |
| --- | --- |
| `observed_at_utc`, `observed_at_bangkok` | Both timestamps; Bangkok date is the business-day grouping key. |
| `action`, `mode` | Action name and `read` or `write`; never infer mode from HTTP GET alone. |
| `sheet` | Sheet pseudonym or approved non-sensitive sheet label. |
| `operation_id`, `attempt_id`, `attempt_number` | One operation ID starts at a user action; every retry receives a new attempt ID and incremented attempt number. |
| `transport`, `cache_hint` | JSONP/fetch where known; `browser-cache`, `Apps-Script-cache`, `unknown`, or another evidenced state. |
| `started_at`, `ended_at`, `duration_ms` | Client-observed timestamps only. For queued writes, also retain queue-entered and final-confirmed times separately. |
| `outcome` | `success`, `api_error`, `lock_failure`, `quota_or_execution_failure`, `http_error`, `jsonp_or_network_error`, `timeout`, `cancelled`, or `unknown`. |
| `http_status`, `api_message_class` | Record only when known; normalize message classes and do not retain user-entered text. |
| `response_bytes` | Body/transfer size when observable; otherwise `unknown`. |

Retries share the same `operation_id` as the original user action. Aggregation must show
both logical-operation success and attempt-level error rate. A retry never becomes a
new user operation merely because JSONP or a sync function issued another request.

### Aggregation and Percentiles

- Group by action, read/write mode, sheet pseudonym, transport, and known cache state.
  Do not pool these groups without an explicit reason.
- For successful attempts, calculate p50 and p95 using nearest rank `ceil(p * n)` and
  publish `n`. Keep timeout and failed attempt counts outside the latency percentile.
- For write operations, publish direct request time, local queue wait, and final visible
  confirmation time as separate measures; do not call one a substitute for another.
- Report daily logical operations, attempts, retries, successful attempts, failed
  attempts, timeout count, and unknown-status count. State coverage before calculating
  a rate.

### Outbox, Apps Script, and Sheet Evidence

- Inspect visit/note outbox counts and oldest `createdAt` age passively on participating
  browsers. Do not edit localStorage, click Sync to create a measurement, or force a
  replay. Capture queue type, count, oldest-age bucket, local observation time, and
  whether a normal sync was observed.
- Use existing Apps Script execution/error records only when access exists. Preserve the
  native timestamp and classify error evidence conservatively; no record is not proof
  of no lock or quota failures.
- Record physical Sheet and `__REPORT_CONFIG` size through direct read-only Sheet
  inspection. Do not invoke helper code that may create or unhide the config tab.
- For reconciliation, compare timestamped Sheet exports and API snapshots by sheet/ID,
  count, active/usable row count, route validity, coordinate validity, visited state,
  and noted presence. Record cache/revision state and any normal edits between snapshots.

### Retention, Privacy, and Documentation

- Keep raw observation notes only in an access-controlled local workspace for at most
  14 days after aggregation, then delete them according to the owner's process.
- Never commit store IDs, store names, branch numbers, maps URLs, coordinates, report
  notes, SKU checks, account credentials, OAuth tokens, cookies, IP addresses, or full
  user-agent strings.
- Commit aggregate-only documentation: date window, source coverage, sample counts,
  latency percentiles, error/timeout counts, backlog age buckets, sheet/config sizes,
  and reconciliation mismatch counts. Use sheet aliases where sheet names are sensitive.
- The baseline document records historical observations. Append a new dated observation
  section rather than overwriting its provenance or treating it as live telemetry.

## Decision Gate A Evidence Sufficiency

Decision Gate A remains a user decision. The evidence below defines what must be
available to make that decision responsibly; it does not select Option A or Option B.

### A. Current CVS_PHANToM Workload

| Evidence area | Minimum evidence before a decision | May be unavailable? | Confidence / coverage requirement |
| --- | --- | --- | --- |
| Read behavior | Per action/sheet successful sample counts, p50/p95, timeout/error counts, payload size, cache-state coverage where known | No; absence means Gate A stays pending | Seven-day window with disclosed missing periods and coverage of normal reads for each active sheet |
| Write behavior | Naturally occurring action counts, logical-operation success, attempt errors/timeouts, and observed acknowledgement/confirmation timing | Yes only if an action did not naturally occur; document it and do not generalize write capacity | Every observed action must retain attempt/operation distinction; unavailable actions require later staging validation |
| Apps Script health | Existing lock/quota/execution evidence or an explicit documented inability to access it | Yes, but this weakens confidence and cannot support a claim that Sheets are proven sufficient | Correlate with the same observation window where possible; zero is valid only with evidence, never by omission |
| Current load | Distinct-user source if available, request volume by action, retry rate, outbox backlog/replay observations | Active users/concurrency may be unavailable if no identity/session source exists | Clearly state source coverage; single-owner context may describe current use but cannot support capacity claims |
| Data scale and validity | Physical Sheet/config dimensions, API payload sizes, duplicate/invalid field checks, and a timestamped reconciliation sample | No for dimensions/payload/validity snapshot | Cover every active sheet and record excluded rows, cache/revision state, and comparison timing |
| Operations readiness | Named owner review of alert, retry, reconciliation, recovery, conflict, and sync-lag responsibilities | No | Written acceptance of responsibilities and unresolved gaps before enabling any two-way sync |

### B. Future Target Workload Assumptions

These are owner-approved targets to collect before a selection. They are intentionally
`TBD`; do not fill them from single-owner CVS_PHANToM observations or CVS_SME usage.

| Assumption | Owner-approved value | Evidence / validation required |
| --- | --- | --- |
| Target active users | TBD | Defined user population and observation period |
| Target peak concurrency | TBD | Explicit concurrent-user and concurrent-request definition; staging validation plan |
| Expected reads per day | TBD | Per-action daily forecast, peak-hour distribution, and retry allowance |
| Expected writes per day | TBD | Per-action forecast including visit/note/config and route/location online-only constraint |
| Offline replay burst | TBD | Maximum queued operations/device, reconnect window, and duplicate/retry behavior |
| Expected store-count growth | TBD | Active sheets, stores/sheet, config-item growth, and planning horizon |
| Target p95 read latency | TBD | Measurement boundary: client observed, action/sheet/cache state, and network assumptions |
| Target p95 write latency | TBD | Separate acknowledgement, queue wait, and final-durability/confirmation target |
| Acceptable Sheet sync delay | TBD | Direction, percentile/maximum, alert threshold, and business impact |
| Reliability target | TBD | Success/error/timeout definition, coverage, and treatment of offline/queued work |

An assumption is usable only when its value, owner, date, rationale, and validation plan
are recorded. A target without a measurement boundary is not a Decision Gate criterion.

### Option Evidence Comparison (No Selection)

| Option | Evidence that would support the option | Evidence that would keep the option unproven or unsuitable |
| --- | --- | --- |
| A. Browser -> Worker -> private Apps Script -> Google Sheets | Current and approved future workload can meet agreed read/write latency, reliability, payload, and sync-delay targets through a gateway; lock/quota evidence is acceptable; Sheets operations and recovery remain manageable without a second operational database | Missing request/error coverage, repeated lock/quota failures, inability to meet approved targets, or no demonstrated operational recovery capacity |
| B. Browser -> Worker -> D1 <-> Google Sheets | Measured or validated future concurrency, latency, availability, write/replay, or Sheet-operation constraints justify a separate operational store; team accepts conflict/versioning, signed bridge, outbox, reconciliation, and recovery ownership; staging can validate parity and two-way synchronization | D1 is proposed only because it seems faster, without workload evidence; no accepted sync ownership; no reconciliation/recovery plan; or gateway-only meets targets with less risk |

Both options require a documented security model, data ownership decision, recovery plan,
and CVS_PHANToM-only pilot boundary before frontend migration. CVS_SME remains outside
this Gate A decision until Phase 9.

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

## Proposed Operational Worker API Contract

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
- **Allowed changes:** read-only export, passive observation, and documentation under the measurement method; no synthetic production mutations or production data path change.
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
- **Rollback/recovery:** pause affected CVS_SME writes and reconcile pending projections
  before switching its flags back to its existing Apps Script path; keep its D1 data
  and sync outbox for diagnosis and replay. CVS_PHANToM remains unaffected.

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
