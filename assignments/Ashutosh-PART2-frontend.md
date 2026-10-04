# Privora — Part 2: Frontend (+ final report)

**Owner:** (name)
**Reference:** `docs/SPEC.md` (final-draft technical spec). Especially §6 (API), §8.5 (socket events), §9 (frontend spec). This doc only says *who builds what*.

## Team split at a glance

| Part | Owner | Scope |
|---|---|---|
| 1 Core backend | Adi | Scaffold, DB, auth, rooms/RBAC/IDOR, file pipeline + validation + storage, base WebSocket |
| 2 Frontend | (name) | React app, API + socket client, UI for all flows, client build, final report |
| 3 Security add-ons | (name) | Headers/CORS/CSRF, rate limiting, audit + admin, encryption at rest, share keys, WS hardening, security tests + ZAP |

## Ground rules (same in all three docs)
- **Folder ownership.** Only edit folders your part owns. Need a change elsewhere → open a PR/issue to the owner.
- **Branches.** `feature/p<part>-<topic>` → PR into `main`.
- **Frozen contracts:** DB schema (§4.1), API (§6), WebSocket events (§8.5). If the backend and the spec disagree, raise it with Part 1 instead of working around it.
- New env vars go in `.env.example` in the same PR.
- Never commit secrets.

## Part 2 owns (folders)
`client/**`, the client build stage consumed by `nginx/Dockerfile`, `docs/REPORT.md` and screenshots.
Does **not** touch `server/**` or `nginx/nginx.conf`.

## How to work without waiting for the backend
- Start immediately against spec §6 using **mock handlers (MSW)**. Switch to the real API with `VITE_API_BASE` once Part 1 publishes `docs/API_EXAMPLES.md` and the endpoints go live.
- Types for requests/responses live in `client/src/api/types.ts`, written from §6 and corrected against `API_EXAMPLES.md`.
- Socket events are specified in §8.5; stub a fake event emitter until Part 1's WebSocket lands.

## Task list

### A. Foundation
- [ ] Vite + React + TypeScript, routing, ESLint with a rule banning `dangerouslySetInnerHTML`
- [ ] **Auth context:** access token in memory only (no `localStorage`/`sessionStorage`), silent refresh on load and on `401`, one in-flight refresh promise
- [ ] API client with `Authorization` header, `credentials: 'include'` only for `/auth/*`, and the `X-Requested-With` header on refresh/logout
- [ ] Build output must be CSP-compatible: **no inline scripts or inline styles**
- [ ] Responsive layout (mobile widths), optional PWA manifest

### B. Screens (spec §9)
- [ ] `/login`, `/register` (show password-policy hints; generic error on bad login)
- [ ] `/rooms` list + create room
- [ ] `/rooms/:roomId`: files list, members panel, online-users panel
  - [ ] Upload with progress; client-side size/extension pre-check (UX only, server is authoritative)
  - [ ] Download (browser saves the attachment), delete, role-aware buttons (hide actions the role can't do)
  - [ ] Members: add by username/email with role, change role, remove, leave room (owner-only controls hidden for others)
- [ ] **Share UI:** create link (expiry, max downloads, optional password), show the key/URL **once** with copy button and a "can't be shown again" notice, list and revoke links
- [ ] `/s/:key` public page: file meta, password prompt if required, download, uniform "link unavailable" message for every failure
- [ ] `/admin/audit` (admin only): filterable audit log table; lock/unlock user

### C. Real-time
- [ ] `useSocket` hook: connect with `auth: { token }` after login, join current room, leave on navigation
- [ ] Apply events from §8.5 to local state (`presence:*`, `file:*`, `member:*`, `share:revoked`, `notification:new`)
- [ ] On `room:access_revoked`: leave the room page with a toast. On `session:revoked`: log out
- [ ] Reconnect with a fresh token after the 15-minute token refresh
- [ ] Notification bell/toast UI

### D. UX hygiene
- [ ] Loading, empty, and error states for every screen
- [ ] Never render server-provided text as HTML; filenames and room names are plain text only
- [ ] Logout clears all state and disconnects the socket

### E. Final report (`docs/REPORT.md`)
Compile the college document from `docs/SPEC.md` and Part 3's `docs/security-test-report.md`: problem statement, architecture diagram, ER diagram, threat→mechanism table, per-mechanism explanation with screenshots/test evidence, conclusion. Collect screenshots of each defense working (blocked IDOR, rejected upload, rate-limit 429, etc.).

## Depends on
| Needs | From | When |
|---|---|---|
| Contracts frozen | Part 1 | Phase 0 |
| Live auth + rooms + API examples | Part 1 | Phase 2 |
| Live files/upload/download | Part 1 | Phase 3 |
| Live presence/events | Part 1 | Phase 4 |
| Share-link endpoints, admin endpoints | Part 3 | Part 3 phases 4/3 |
| Security test results for the report | Part 3 | end |

## Done when
All screens work against the real API, roles correctly hide/show actions, live events update the UI without refresh, no token is ever stored in browser storage, and the report is assembled with evidence for each mechanism.
