# Phase 0 Baseline - 2026-09-30

## Scope and Safety

This is a read-only baseline for the existing CVS_PHANToM production data path.
No Google Sheet cells, Apps Script code, frontend traffic, or user workflow were changed.
Store names, coordinates, report text, and other row-level data are intentionally excluded
from this document.

CVS_PHANToM is the owner-operated reference implementation. It is the only repository
in scope for this baseline and future backend experiments. CVS_SME has active users and
must remain on its independent stable path until a CVS_PHANToM release is proven, cloned
with separate Cloudflare/Sheets resources, and validated through its own rollout gate.

Historical snapshot collected at: `2026-09-30T11:41:20.994Z` (`18:41:20` Asia/Bangkok)

## Isolated Worker DEV Check

| Item | Result |
| --- | --- |
| Worker name | `cvs-phantom-api-dev` |
| Public DEV URL | `https://cvs-phantom-api-dev.surakiat16082000.workers.dev` |
| Deployed version | `38a3701e-65b0-42ad-8260-9eddabe82086` |
| Local `GET /health` | `200` |
| Remote `GET /health` | `200` |
| Unknown route | `404` |
| Bindings/secrets/D1 | None |
| Existing frontend and Apps Script traffic | Untouched |

The Worker currently returns only this non-sensitive health payload:

```json
{
  "ok": true,
  "service": "cvs-phantom-api-dev",
  "environment": "development"
}
```

## Existing API Read Baseline

The endpoint configured in `index.html`, `Tools/Report.html`, and
`Tools/ReportAdmin.html` was queried with existing read-only actions using the same
JSONP response format as the browser application.

| Sheet | Rows | Visited | Remaining | Route present | Location present | Noted present | Duplicate IDs | Response size | One successful read |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `DB_GBKK4` | 120 | 95 | 25 | 0 | 120 | 120 | 0 | 77,529 B | 3,054 ms |
| `DB_GBKK2` | 364 | 62 | 302 | 364 | 364 | 309 | 0 | 247,746 B | 4,423 ms |
| `SME_CVS20` | 190 | 159 | 31 | 190 | 190 | 190 | 0 | 446,288 B | 6,158 ms |
| **Total** | **674** | **316** | **358** | **554** | **674** | **619** | **0** | **771,563 B** | - |

`getSheets` returned three usable sheets and default sheet `DB_GBKK4`. One `getSheets` read (cache state unknown) took `26,928 ms`; it returned a 101-byte response.

## Reliability Observation

Repeated read-only calls were intentionally attempted to measure p50/p95 latency.
The sequence did not complete reliably: direct non-JSONP retrieval produced transient
HTTP `404` responses after the Apps Script redirect, while a later JSONP sequence stalled.
The baseline therefore records the successful sample timings above, but does **not** claim
valid p50/p95 figures yet.

These observations show variable latency and retrieval failures in the sampling path;
their cause and representativeness of normal browser traffic are not established. No retry storm was
allowed; the run was stopped without issuing any mutation request.

## Current Implementation Facts

| Area | Observed baseline |
| --- | --- |
| Server cache | Apps Script caches place responses for 300 seconds (`CACHE_TTL_SEC = 300`). |
| Write serialization | Visit, report-note, route, and location writes use a script lock with a 1-second acquisition window. Bulk report-config writes use 5 seconds. |
| Browser offline writes | `PT_GBKK_VISIT_OUTBOX_V1` and `PT_GBKK_NOTED_OUTBOX_V1` are durable localStorage outboxes. The note outbox keeps the latest value for each `(sheetName, id)`. |
| Browser retry | Pending visits and notes sync at boot, when online, and through the Sync button. |
| Route/location edits | Current route and location updates are direct API calls; they do not have a durable browser outbox. |
| Identity quality | The three sampled sheets had no duplicate store IDs within a sheet. Future backend identity remains `(team_id, sheet_store_id)`, not a globally assumed ID. |

## Evidence Provenance and Measurement Method

The timestamp, deployment version, health results and counts above are historical
records retained from the original baseline. This documentation review on 2026-09-30
checked local source only; it did not query production, re-test deployment, create
resources or collect new latency samples. Original raw attempt logs, complete sample
counts, timeout settings and byte-count methodology are not supplied here, so these
figures are provisional observations, not a reproducible performance benchmark.
The original no-change statement is a recorded collection claim, not a fresh remote audit.

Local evidence: `workers/cvs-phantom-api-dev/src/index.js` implements health and 404
only; `wrangler.jsonc` contains no bindings. `index.html` and Report tools reference
Apps Script. `code.gs.txt` confirms the 300-second place cache and lock windows.
Local source does not independently prove the deployed Apps Script version.

Use [Phase 0 Measurement Method](WORKER_D1_SHEETS_BACKEND_PLAN.md#phase-0-measurement-method)
for subsequent observations: proposed seven days of passive normal usage; record
actual time range, coverage, action/sheet/transport, all attempts and failures. Read
probes, if undertaken separately, are sequential, spaced at least 60 seconds, limited
to 10 per session with a 60-second timeout, and stop on the first error. Compute
nearest-rank p50/p95 per action only with sample counts and limitations; do not
convert successful-only timings into reliability claims. No observation window has
yet been completed. Seven elapsed days or a fixed sample count alone cannot satisfy
Gate A. No synthetic production writes, forced replay or load tests.

The source-confirmed metric-by-metric collection matrix, 7-day protocol, privacy rules,
minimal telemetry designs, and Decision Gate A evidence requirements are in
[WORKER_D1_SHEETS_BACKEND_PLAN.md](WORKER_D1_SHEETS_BACKEND_PLAN.md#phase-0-detailed-measurement-matrix).
Those sections are design only and do not authorize telemetry implementation or any
production behavior change.

| Metric | Existing evidence | Remaining status / permitted method |
| --- | --- | --- |
| Read latency | One success per sheet and one getSheets timing | No valid p50/p95; passive reads or bounded safe read probes |
| Write latency | Static mutation paths only | Unavailable/needs telemetry or existing passive normal-use records; never initiate a write for measurement |
| Error rate | Incomplete HTTP 404/stall observations | Denominator missing; record all attempts and API outcomes prospectively |
| Lock/quota failures | Static lock acquisition windows | Counts unavailable/needs telemetry; inspect existing execution/API records if accessible |
| Active/peak users and request volume | Reported one owner | Measured concurrency and totals unavailable/needs telemetry; partial device records cannot establish global usage |
| Outbox replay | Durable visit/noted formats in source | Historical volume unavailable/needs telemetry; passive queue snapshots show backlog only |
| Data size | 674 API-returned places, response sizes above | Physical row/column/config counts and growth unmeasured; use existing read-only exports/inspection |
| Reconciliation and sync operability | ID uniqueness and field-presence snapshot | No full parity comparison or recovery evidence; compare timestamped read-only snapshots and document operational capacity |

`getPlaces` excludes rows without ID/name, so returned places are not physical Sheet
row counts. Presence does not prove route/location validity. `getReportConfig` is
not an unconditional read-only probe: `getReportConfigSheet_()` can insert or unhide
a tab on cache miss. GET mutations also exist. Review handler side effects before
any future probe; cache/revision metadata writes may occur even on data reads.

### Current Measured Load and Future Assumptions

The single-owner context is reported usage, not measured concurrency=1. Sequential
read sampling cannot establish capacity for concurrent users. Future target users,
request concurrency, read/write mix, growth, replay bursts and latency/sync targets
are TBD assumptions for separate staging validation, not baseline results. The
`SME_CVS20` tab in this API snapshot is a sheet name; it does not demonstrate access
to, workload of, or authorization to change the separately deployed CVS_SME app.

## Phase 0 Gaps Before Decision Gate A

The following remain unavailable / need telemetry or additional read-only evidence before
choosing Worker gateway only versus Worker plus D1. No complete 7-day window has been
collected. Observe naturally occurring use; do not generate writes, force replay, or
modify production to fill these gaps under this documentation task:

- 7-day p50/p95 read and write latency by API action.
- HTTP/API errors, Apps Script lock rejections, and quota errors.
- Daily active users, concurrent peak users, read/write volume, and outbox replay volume.
- Google Sheet row/column size and configuration-sheet size over time.
- A documented sync operations owner, recovery responsibilities, and support capacity.
- Explicit future workload assumptions and target latency, separate from current usage.
- A read-only reconciliation sample comparing sheet IDs, route/location validity, visited
  state, and noted presence.

## Decision Gate A

**Status: not decided; blocked by incomplete Phase 0 metrics.** The recorded DEV Worker
checks passed, but Phase 0 data is not
yet sufficient to choose a backend path. D1 foundation has not started and must wait
until metrics are sufficient and Decision Gate A explicitly approves D1. Preserve the
existing Google Sheets/App Script production path while collecting the missing observational
metrics. No frontend connection to the Worker is permitted before this decision is made.
