# Privora — Part 3: Security Add-ons, Hardening & Tests

**Owner:** (name)
**Reference:** `docs/SPEC.md` (final-draft technical spec). Mechanism details are in §7, share keys in §5.5, test matrix in §12. This doc only says *who builds what*.

## Team split at a glance

| Part | Owner | Scope |
|---|---|---|
| 1 Core backend | Adi | Scaffold, DB, auth, rooms/RBAC/IDOR, file pipeline + validation + storage, base WebSocket |
| 2 Frontend | (name) | React app, API + socket client, UI for all flows, client build, final report |
| 3 Security add-ons | (name) | Headers/CORS/CSRF, rate limiting, audit + admin, encryption at rest, share keys, WS hardening, security tests + ZAP |

## Ground rules (same in all three docs)
- **Folder ownership.** Only edit folders your part owns. Need a change elsewhere → open a PR/issue to the owner.
- **Branches.** `feature/p<part>-<topic>` → PR into `main`. Part 1 reviews backend PRs that touch auth, files, or storage.
- **Frozen contracts:** DB schema (§4.1), API (§6), WebSocket events (§8.5), and the stub interfaces below.
- New env vars go in `.env.example` in the same PR.
- Never log or commit secrets, tokens, or share keys.

## Stub interfaces you replace (Part 1 creates them in Phase 0)

| Interface | File | You implement |
|---|---|---|
| `audit.log({...})` | `modules/audit/audit.ts` | DB insert into `audit_logs`, never throws into request flow |
| `fileCrypto.encrypt/decrypt` | `crypto/fileCrypto.ts` | Real envelope encryption (spec §7.10) replacing the dev-only passthrough |
| `applySecurity(app)` | `middleware/security.ts` | Helmet + CORS + CSRF guard |
| `limiters.{global,auth,upload,share}` | `middleware/rateLimit.ts` | Real `express-rate-limit` instances |
| `emit.shareRevoked`, `emit.notify` | `realtime/emit.ts` | Add these helpers |

You keep the **function signatures unchanged**. Part 1 has already wired them into `app.ts`, so you should not need to edit `app.ts`.

## Part 3 owns (folders)
`server/src/middleware/{security,rateLimit,csrf}.ts`, `server/src/modules/{audit,admin,shareLinks}`, `server/src/crypto/fileCrypto.ts`, `server/src/realtime/hardening.ts`, `nginx/nginx.conf`, `server/tests/*` for your mechanisms, `docs/security-test-report.md`.

## Task list (suggested order)

### 1. HTTP hardening (spec §7.11) — independent, start now
- [ ] Helmet with the CSP/HSTS/COOP/CORP/Referrer/Permissions headers from the spec; remove `X-Powered-By`
- [ ] CORS strict allowlist from `CORS_ORIGIN`, credentials for that origin only
- [ ] CSRF guard on `/auth/refresh` and `/auth/logout`: `Origin` check + `X-Requested-With`
- [ ] `trust proxy` setting for running behind Nginx
- [ ] Nginx: TLS server block, HTTP→HTTPS redirect, `client_max_body_size 26m`, `/api` + `/socket.io` proxying (WebSocket upgrade), static headers, **no Redis involved**

### 2. Rate limiting (spec §7.5) — independent
- [ ] Nginx `limit_req` zones: general `/api/`, tighter `/api/auth/` and `/api/s/`
- [ ] `express-rate-limit` (in-memory store) with the tiers from the spec table; `429` + `Retry-After`
- [ ] Lockout itself is Part 1 (DB-backed); you only test it
- [ ] Tests: `ratelimit.test.ts`

### 3. Audit logging + admin (spec §7.12)
- [ ] Implement `audit.log`; DB role grants INSERT/SELECT only on `audit_logs`
- [ ] Add `audit.log` calls for the full event list in the spec wherever Part 1 left hooks (coordinate through PR comments)
- [ ] `GET /admin/audit-logs` with filters + pagination, `PATCH /admin/users/:id/lock`, `requireGlobalAdmin` middleware
- [ ] Redaction check: no passwords/tokens/keys in `metadata`

### 4. Encryption at rest (spec §7.10) — independent unit
- [ ] AES-256-GCM, per-file DEK, KEK wrap, `kek_version` support, tag verification before returning plaintext
- [ ] Config loading for `FILE_KEK_V{n}`
- [ ] Tests: `crypto.test.ts` (round trip, tampered ciphertext fails, wrong KEK fails, IVs unique)

### 5. Secure share keys (spec §5.5, §7.9) — after Part 1 Phase 3
- [ ] Create / list / revoke endpoints with role rules; key shown once; only hash stored
- [ ] Public `meta` and `download` endpoints, optional password (argon2id), uniform `404`
- [ ] Atomic counter `UPDATE … RETURNING` redeem
- [ ] Uses `filesService.getDecryptedForShare`; emits `share:revoked`; audit events; `limiters.share`
- [ ] Tests: `share-links.test.ts` including the 50-concurrent-redeem race

### 6. WebSocket hardening (spec §8.7, §7.13) — after Part 1 Phase 4
- [ ] Disconnect at JWT `exp`
- [ ] Origin allowlist, `maxHttpBufferSize: 10_000`, per-user connection cap
- [ ] Per-socket token-bucket rate limit (20 events/10 s), disconnect on repeated violations
- [ ] `notification:new` + `emit.notify`
- [ ] Tests added to the socket suite

### 7. Cross-cutting verification (spec §12) — last
- [ ] Run the full attack table in §12.1 against the running Compose stack; fill gaps in tests
- [ ] OWASP ZAP baseline scan, save report
- [ ] `docs/security-test-report.md`: table of attack → expected → actual → evidence; list of any accepted risks
- [ ] `npm audit` result noted

## Depends on
| Needs | From | When |
|---|---|---|
| Stubs + frozen schema | Part 1 | Phase 0 (tasks 1–4 can start right after) |
| File pipeline | Part 1 | Phase 3 (task 5) |
| Base WebSocket | Part 1 | Phase 4 (task 6) |

## Hand-offs out
- Part 2 needs the share-link and admin endpoints with examples added to `docs/API_EXAMPLES.md`.
- Part 2 needs your test evidence for the final report.

## Done when
Every checkbox is ticked, all tests for your mechanisms pass in CI, the ZAP report has no unaddressed high findings, and `docs/security-test-report.md` is complete.
