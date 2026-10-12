# Prototype verification

Build started October 12, 2026; verification continued October 13 (Asia/Kolkata).

## Automated checks

- TypeScript typecheck and Vite production build: passed.
- Core, API, and provider suite: **21 passed**, **1 skipped** (22 including subtests). The skipped test is the explicit FalkorDB integration test.
- Scenarios checked: full investigation/approval/recovery, saved conversation and database reopen, memory supersession, expired leases, stale-worker rejection, competing task claims, tenant isolation, session signatures, origin validation, request validation, and hosted-demo access codes.
- Express middleware and routes were tested using injected Node HTTP objects, without a listening network socket. This is not a live HTTP transport test.
- OpenAI tests use mocked HTTP responses: authorization headers, Responses output parsing after reasoning items, disabled response storage, authenticated connection checks, provider selection, missing-key errors, HTTP failures, timeouts, refusals, incomplete responses, and redacted error messages. The Anthropic adapter is also covered with a mocked response.
- A database reopen test proves that an AI follow-up receives the incident's saved conversation while excluding messages from another incident and another tenant. A provider-failure test proves the task stays at its checkpoint and completes its handoff after an explicit retry. These checks validate application behavior, not live model quality.
- Local SQLite benchmark: 50 workers, 1,000 writes, 1,000 records present, zero missing writes; one successful claim and zero duplicate claims. One observed run reported 17,172 read/write pairs per second and 5.53 ms p95 per read/write pair. These figures describe a synchronous local SQLite load generator, not FalkorDB or distributed throughput.

## Browser review

The standalone `preview.html` was exercised in Safari through the native UI. The same engine uses a separate browser-local demo store in this artifact.

Verified through visible UI states:

1. Atlas retrieved prior incident memory and handed the investigation to Sage.
2. Sage produced a plan and waited for explicit recovery approval.
3. New migration evidence superseded `orders-db` with `orders-db-v2`, preserved the old fact, and invalidated the plan.
4. Reloading the page preserved the paused checkpoint.
5. Resuming generated a new plan for `orders-db-v2`.
6. After approval, Sage applied the simulated change and Echo recorded a verified outcome. All three agents completed their work.
7. The conversation answered a question using prior incident context.
8. Switching to Orbit Financial showed its separate service, sample incident, and original memory set.
9. Shared memory graph layout was visually inspected. The 390 × 844 responsive dashboard was inspected and mobile navigation visibility/card overflow issues were corrected. Opening the mobile drawer and navigating to Agent team was verified; the preview was restored to desktop mode afterward.

The desktop static dashboard was also visually inspected in Chrome. The browser demo must be used in one tab at a time. Background browsers may throttle its simulated agent timers; the server implementation runs its workers outside the browser.

### Readability pass · October 13

- Replaced the previous 7–11 px text scale with 16 px body text, 14–15 px supporting text, and a 12 px minimum for compact metadata. Strengthened text contrast, enlarged controls, and increased card spacing.
- The core text palette measures at least 4.5:1 against the white card and pale page backgrounds. This is a palette check, not a full accessibility audit.
- Rebuilt graph labels at a fixed readable size with wrapped titles and an internally scrollable canvas. Mobile shared memory opens in the card library by default.
- Safari review verified the desktop dashboard and settings; the 390 × 844 incident form, mobile navigation, memory library, and memory detail dialog; and settings at 320 × 844.
- Removed the dialog entrance animation that left dialogs invisible in background Safari captures. Dialogs now show immediately, lock page scrolling, retain their heading, and keep form actions visible while the body scrolls. Both desktop and mobile incident dialogs were visually rechecked.
- The preview was returned to desktop mode. It is an interactive browser-local simulation, not proof of a localhost listener or a live AI connection.

## Not verified in this environment

- Live FalkorDB queries, transaction semantics, performance, and Docker persistence. Docker socket access was denied and the SDK was unavailable in the offline package cache. The adapter and an opt-in integration test are included.
- Real model responses. An OpenAI credential is now configured in the ignored server `.env` file with owner-only permissions. A live connection check failed during DNS resolution (`ENOTFOUND`), before authentication. The key's validity and real model responses remain unverified; the standalone browser preview remains a deterministic simulation.
- Live server HTTP transport or the Playwright server-backed end-to-end suite. Local listening sockets were initially denied (`EPERM`); subsequent starts did not produce a listener reachable by curl or native Safari. No working localhost server is claimed. A native-browser review of the standalone demo was completed instead. The Mac launcher is provided for starting the server in the user's Terminal.
- Production deployment, external infrastructure actions, production identity, or production security boundaries. These are outside the scope of this prototype.

Run the commands in the README against a dedicated FalkorDB instance and a real model before calling the entry graph-backed or model-powered. Retain the disclosed pre-event build date.
