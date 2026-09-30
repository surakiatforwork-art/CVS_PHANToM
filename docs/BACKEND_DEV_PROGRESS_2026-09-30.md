# CVS_PHANToM Backend DEV Progress - 2026-09-30

## Scope

This is an isolated **provisional Worker gateway + Apps Script + Google Sheets staging**
experiment. It is not a Decision Gate A selection or production migration. The
original frontend, production Apps Script deployment, production Google Sheets, and
the separately deployed CVS_SME app have not been connected to this experiment.

## Implemented

- Wrangler authenticated against the approved Cloudflare account.
- `workers/cvs-phantom-api-dev/` contains a deployed DEV Worker supporting
  `/health`, teams, stores, visits, reset (disabled), noted, route/location,
  report-config reads, and config replacement (disabled).
- DEV Worker bearer authentication is only for CLI/staging use. It is **not**
  a production user/session/role-authentication solution.
- All mutating routes require a persistent `Idempotency-Key`. Route, location,
  noted and config writes require `baseVersion`; stale field versions return 409.
- Worker signs Apps Script bridge envelopes with HMAC-SHA256; the bridge checks
  signature, timestamp, nonce, and action. Only server-side secrets are used.
- Bridge script is isolated at `apps-script/cvs-phantom-bridge-dev/`. Its source
  is pushed to an independent Apps Script DEV project and an initial deployment
  exists. No code was pushed to the production Apps Script project.
- A separate `CVS_PHANToM_BACKEND_STAGING` Google spreadsheet was created with
  the `DB_GBKK4` sheet and all 506 populated rows (including the header) from
  `__REPORT_CONFIG`. The staging spreadsheet timezone is Asia/Bangkok; Drive
  permission metadata confirms that it is not shared and has only its owner.
- DEV secret values reside under the owner's local
  `%LOCALAPPDATA%\CVS_PHANTOM_BACKEND_DEV\`, **outside the Git repository**.
- D1, Queue and Cron have not been created. Edge caching is disabled by default.

## Verified Tests

- `node apps-script/cvs-phantom-bridge-dev/test/bridge-smoke.cjs` passed:
  signed-envelope verification, replay rejection, idempotent replay,
  same-key/different-payload conflict, fail-closed uncertain outcomes, and
  report-config replacement preserving other accounts, and stale field-version
  writes being rejected without modifying the value.
- `node workers/cvs-phantom-api-dev/test/worker-smoke.mjs` passed.
- Both source files passed `node --check`; Wrangler `deploy --dry-run` passed.
- DEV Worker was deployed to `https://cvs-phantom-api-dev.surakiat16082000.workers.dev`.
  On the deployed version, `GET /health` returned 200, unauthenticated
  `GET /v1/teams` 401, invalid token 403, and disabled-admin reset 403.
- Authenticated `GET /v1/teams` currently returns 500 because Google's
  initially deployed Web App returns 403; this is an **unresolved integration
  blocker**, not a passing end-to-end test.

## Manual Google Configuration Required

The standalone Apps Script DEV project currently cannot be invoked via
`clasp run` using the present CLI OAuth configuration. In addition, the
initial CLI deployment does not offer the required anonymous Web App access.
The owner must finish DEV-only setup in the Apps Script editor:

1. Open the `CVS_PHANToM Bridge DEV` project corresponding to the local
   `apps-script/cvs-phantom-bridge-dev/.clasp.json`.
2. Project Settings -> Script Properties: set `SPREADSHEET_ID` to the value
   in local `staging-spreadsheet-id.txt` and `BRIDGE_SECRET` to the value
   in local `bridge-secret.txt`. Do not post the secret in chat or commit it.
3. In the editor select `authorizeDevStaging`, click Run, and approve required
   Google permissions for the user's own staging spreadsheet.
4. Deploy -> New deployment -> type **Web app**; execute as the deploying
   user, access **Anyone**. The signed bridge rejects unauthenticated POSTs.
5. Supply the **new DEV /exec URL only** to the implementer so the
   `BRIDGE_URL` Worker secret can be updated. Never send `BRIDGE_SECRET`.

Afterward, test authorized read/write on staging only, version conflicts,
duplicate retries, failure/recovery and report-config isolation, and compare
staging data before and after. Production must remain unchanged.

## Known Limitations and Release Gates

- **No end-to-end passing tests yet.** Do not connect the frontend or claim
  backend readiness until the DEV bridge returns authenticated read/write
  success and staging parity/recovery tests pass.
- Script Properties idempotency receipts are durable relative to cache but
  have finite storage; a failure between the Sheet write and receipt completion
  leaves a `pending` request requiring manual reconciliation. A bounded
  retention/archival and recovery procedure must be approved before production.
- `getPlaces` reads Sheets directly; Apps Script latency and concurrency
  limits still require representative measurements. No D1 decision has been made.
- The DEV shared bearer token is not a user/role management scheme. Production
  identity and per-team authorization must be completed before frontend cutover.
- Manual Sheet edits can change fields without bumping the sheet-wide revision.
  The field-content hash detects stale route/location/noted writes, but cannot
  substitute for a full change log if D1 two-way sync is later selected.
- Admin reset and Report config replacement remain disabled in Worker DEV
  until their own tests are complete.
- Phase 0 p50/p95, request/error rate, user concurrency and operational
  recovery evidence are incomplete. Decision Gate A remains pending.
- Do not modify `index.html`, `Tools/*`, production `code.gs.txt`,
  production Sheets, or CVS_SME within this backend-only task.
