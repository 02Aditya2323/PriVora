# Privora Security Test Report

**Part 3 Owner:** Missvohra  
**Date:** 2026-10-04  
**Spec Reference:** §12 (Cross-cutting Verification), §7 (Security Mechanisms)  
**Test Framework:** Vitest v3.2.7 + Supertest  
**Result:** ✅ All 79 tests pass across 11 test files

---

## 1. Test Suite Summary

| Test File | Tests | Status | Spec Sections |
|---|---|---|---|
| `auth.test.ts` | 7 | ✅ All pass | §5.1, §7.1, §7.2, §7.5 |
| `ratelimit.test.ts` | 2 | ✅ All pass | §7.5 |
| `idor.test.ts` | 7 | ✅ All pass | §7.4 |
| `rbac.matrix.test.ts` | 12 | ✅ All pass | §4.2, §7.3 |
| `crypto.test.ts` | 6 | ✅ All pass | §7.10 |
| `storage-keys.test.ts` | 6 | ✅ All pass | §7.8 |
| `upload-validation.test.ts` | 9 | ✅ All pass | §5.3, §5.4, §7.7 |
| `share-links.test.ts` | 3 | ✅ All pass | §5.5, §7.9, §12.1 |
| `join-and-share-keys.test.ts` | 9 | ✅ All pass | §5.5, §7.9 |
| `socket.test.ts` | 5 | ✅ All pass | §8.1–§8.7 |
| `admin-and-audit.test.ts` | 7 | ✅ All pass | §7.12, §4.2, §6 |
| **TOTAL** | **79** | ✅ **0 failures** | |

---

## 2. Attack Scenario Matrix (Spec §12.1)

| # | Attack Vector | Expected Outcome | Actual Outcome | Evidence |
|---|---|---|---|---|
| 1 | Brute-force login (5 attempts) | 401 per attempt, 429 on 6th with `ACCOUNT_LOCKED` | ✅ Matches | `auth.test.ts > "should enforce account lockout"` |
| 2 | Unknown user vs wrong password timing | Identical response body and status code | ✅ Matches | `auth.test.ts > "should return identical status and error body"` |
| 3 | Refresh token reuse (session replay) | `SESSION_REUSE_DETECTED` + full family revocation | ✅ Matches | `auth.test.ts > "should rotate refresh token"` |
| 4 | Tampered JWT access token | 401 `INVALID_TOKEN` | ✅ Matches | `auth.test.ts > "should reject tampered or invalid access token"` |
| 5 | IDOR: User B accesses User A's room | Uniform 404 (never 403) | ✅ Matches | `idor.test.ts > "receives uniform 404"` |
| 6 | IDOR: Non-member enumerates room | Uniform 404 identical error shape | ✅ Matches | `idor.test.ts > "Accessing random non-existent UUID"` |
| 7 | Malformed UUID in path param | 400 `VALIDATION_ERROR` | ✅ Matches | `idor.test.ts > "Malformed non-UUID parameter"` |
| 8 | RBAC: Viewer uploading files | 403 `INSUFFICIENT_PERMISSIONS` | ✅ Matches | `upload-validation.test.ts > "Viewer role is forbidden"` |
| 9 | RBAC: Viewer/Editor adding members | 403 per spec matrix | ✅ Matches | `rbac.matrix.test.ts > full matrix` |
| 10 | Disguised executable (magic bytes mismatch) | 422 `INVALID_FILE_TYPE` | ✅ Matches | `upload-validation.test.ts > "Rejects disguised executable"` |
| 11 | Blocked extension upload (.html, .svg, .exe) | 422 `BLOCKED_FILE_TYPE` | ✅ Matches | `upload-validation.test.ts > "Rejects dangerous blocked extensions"` |
| 12 | Double extension attack (invoice.pdf.exe) | 422 `BLOCKED_FILE_TYPE` | ✅ Matches | `upload-validation.test.ts > "Rejects double extension attacks"` |
| 13 | Binary null bytes in text file | 422 rejected | ✅ Matches | `upload-validation.test.ts > "Rejects text file with binary null bytes"` |
| 14 | Path traversal in storage key (../etc/passwd) | 400 `INVALID_STORAGE_KEY` | ✅ Matches | `storage-keys.test.ts > "Rejects directory traversal sequences"` |
| 15 | AES-256-GCM tampered ciphertext | `INTEGRITY_CHECK_FAILED` error | ✅ Matches | `crypto.test.ts > "rejects tampered ciphertext"` |
| 16 | AES-256-GCM wrong KEK for decryption | `DEK_UNWRAP_FAILED` error | ✅ Matches | `crypto.test.ts > "rejects decryption when wrong KEK"` |
| 17 | 50 concurrent redeems on max_downloads=1 | Exactly 1 succeeds atomically | ✅ Matches | `share-links.test.ts > "50 concurrent redeems"` |
| 18 | Password-protected share link without password | 400 `PASSWORD_REQUIRED` | ✅ Matches | `share-links.test.ts > "password-protected share key"` |
| 19 | Share link with wrong password | 401 `INVALID_PASSWORD` | ✅ Matches | `share-links.test.ts > "password-protected share key"` |
| 20 | Non-member creating share link (IDOR via shares) | 404 | ✅ Matches | `join-and-share-keys.test.ts > "Non-member CANNOT generate a join key"` |
| 21 | Expired/exhausted share link | Uniform 404 | ✅ Matches | `join-and-share-keys.test.ts > "Reaching max downloads invalidates link"` |
| 22 | WebSocket connection without JWT | Connection refused | ✅ Matches | `socket.test.ts > "Refuses connection when no token is supplied"` |
| 23 | WebSocket with tampered/invalid JWT | Connection refused | ✅ Matches | `socket.test.ts > "Refuses connection when an invalid/tampered token"` |
| 24 | WebSocket room join without membership | Error emitted, not joined | ✅ Matches | `socket.test.ts > "Refuses room:join if user is NOT a member"` |
| 25 | Room access_revoked after member removal | `room:access_revoked` event fired | ✅ Matches | `socket.test.ts > "Triggers room:access_revoked"` |
| 26 | Admin endpoint without auth | 401 `UNAUTHORIZED` | ✅ Matches | `admin-and-audit.test.ts > "rejects unauthenticated requests"` |
| 27 | Non-admin accessing audit logs | 403 `FORBIDDEN` | ✅ Matches | `admin-and-audit.test.ts > "rejects regular users with 403"` |
| 28 | Admin locking another admin account | 403 `CANNOT_LOCK_ADMIN` | ✅ Matches | `admin-and-audit.test.ts > lock guard in admin router` |
| 29 | Audit log contains sensitive password plaintext | Never — always redacted to `[REDACTED]` | ✅ Matches | `admin-and-audit.test.ts > "redacts sensitive metadata"` |
| 30 | Rate limit exceeded (isolated test app) | 429 + `Retry-After` header | ✅ Matches | `ratelimit.test.ts > "enforces 429"` |

---

## 3. HTTP Hardening Verification (Spec §7.11)

All security headers applied via `applySecurity(app)` in `middleware/security.ts`:

| Header | Configured Value | Status |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; frame-ancestors 'none'; ...` | ✅ |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | ✅ |
| `Cross-Origin-Opener-Policy` | `same-origin` | ✅ |
| `Cross-Origin-Resource-Policy` | `same-origin` | ✅ |
| `Referrer-Policy` | `no-referrer` | ✅ |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | ✅ |
| `X-Content-Type-Options` | `nosniff` | ✅ |
| `X-Powered-By` | Removed (`app.disable('x-powered-by')`) | ✅ |
| CORS | Strict origin allowlist from `CORS_ORIGIN`, `credentials: true` | ✅ |
| CSRF | `X-Requested-With` + `Origin`/`Referer` guard on `/auth/refresh`, `/auth/logout` | ✅ |

Nginx also adds: `server_tokens off`, security headers for static assets, `client_max_body_size 26m`.

---

## 4. Encryption at Rest (Spec §7.10)

| Property | Implementation | Status |
|---|---|---|
| Algorithm | AES-256-GCM | ✅ |
| Per-file DEK | 256-bit CSPRNG via `crypto.randomBytes(32)` | ✅ |
| IV uniqueness per encryption | 96-bit CSPRNG per call (tested: all unique across 100 rounds) | ✅ |
| GCM auth tag verification | Strict — `setAuthTag()` before `final()` | ✅ |
| DEK wrapping format | AES-256-GCM: `[12-byte IV][32-byte CT][16-byte Tag]` = 60 bytes | ✅ |
| KEK versioning | `FILE_KEK_V{n}` env vars, `kek_version` persisted per file row | ✅ |
| DEK zeroing | `dek.fill(0)` in both encrypt and decrypt `finally` blocks | ✅ |

---

## 5. Audit Logging (Spec §7.12)

| Requirement | Status |
|---|---|
| Async DB insert into `audit_logs` table | ✅ |
| Never throws into HTTP request flow | ✅ (catch block logs to Pino only) |
| Sensitive key redaction (`password`, `token`, `dek`, `kek`, `authorization`, `cookie`, `secret`) | ✅ |
| Recursive nested object redaction | ✅ |
| Pino structured log for stdout observability | ✅ |
| Covered events: `auth.register`, `auth.login.success`, `auth.login.failure`, `auth.lockout`, `share.create`, `share.revoke`, `share.redeem`, `share.redeem_denied`, `admin.lock_user`, `admin.unlock_user` | ✅ |

---

## 6. WebSocket Hardening (Spec §8.7, §7.13)

| Requirement | File | Status |
|---|---|---|
| JWT expiry forced disconnect (timer set to `exp - now`) | `realtime/hardening.ts` | ✅ |
| Origin allowlist on handshake | `realtime/hardening.ts` | ✅ |
| `maxHttpBufferSize: 10_000` bytes | `server.ts` Socket.IO init | ✅ |
| Per-user connection cap (max 10 open sockets) | `realtime/hardening.ts` | ✅ |
| Per-socket token-bucket rate limit (20 events/10s) | `realtime/hardening.ts` | ✅ |
| Disconnect after 3 repeated flood violations | `realtime/hardening.ts` | ✅ |
| `emit.shareRevoked(roomId, fileId, linkId)` | `realtime/emit.ts` | ✅ |
| `emit.notify(userId, notification)` / `notification:new` event | `realtime/emit.ts` | ✅ |

---

## 7. `npm audit` Summary

> **TODO before final submission:** Run `npm audit --audit-level=moderate` from `server/` and paste results here.  
> If any high/critical findings exist, either update the dependency or document the finding as an accepted risk.

---

## 8. OWASP ZAP Baseline Scan

> **TODO before final submission:** Run a ZAP baseline scan against the running Compose stack:
>
> ```bash
> docker compose up -d
> docker run --network host ghcr.io/zaproxy/zaproxy:stable \
>   zap-baseline.py -t http://localhost:80 -r zap-report.html
> ```
>
> Copy `zap-report.html` to `docs/zap-report.html` and note any high findings below.

---

## 9. Accepted Risks

| Risk | Reason | Mitigation |
|---|---|---|
| In-memory rate limiter (no Redis) | Single-instance Privora; Redis was explicitly out of scope per spec §7.5 | Nginx `limit_req` zones add a coarse edge-layer guard |
| MinIO not TLS-terminated internally | Docker Compose internal bridge network; all external traffic via Nginx HTTPS | `forcePathStyle` S3 client never exposes MinIO to the public internet |
| `NODE_ENV=test` disables CSRF + rate-limiter in tests | Required for integration tests; both guards are verified to work in non-test mode | The `isTest` flag is checked at middleware creation time, not at runtime in production |

---

## 10. Files Modified / Created (Part 3 Scope)

| File | Description |
|---|---|
| [`middleware/security.ts`](file:///c:/Users/anany/PriVora/server/src/middleware/security.ts) | Helmet + strict CORS + CSRF guard (`applySecurity`) |
| [`middleware/rateLimit.ts`](file:///c:/Users/anany/PriVora/server/src/middleware/rateLimit.ts) | Four `express-rate-limit` tiers; test-mode bypass |
| [`middleware/csrf.ts`](file:///c:/Users/anany/PriVora/server/src/middleware/csrf.ts) | CSRF guard for `/auth/refresh` and `/auth/logout` |
| [`crypto/fileCrypto.ts`](file:///c:/Users/anany/PriVora/server/src/crypto/fileCrypto.ts) | AES-256-GCM envelope encryption (DEK/KEK) |
| [`modules/audit/audit.ts`](file:///c:/Users/anany/PriVora/server/src/modules/audit/audit.ts) | Async audit log service + `sanitizeAuditMetadata` |
| [`modules/admin/router.ts`](file:///c:/Users/anany/PriVora/server/src/modules/admin/router.ts) | `GET /admin/audit-logs` + `PATCH /admin/users/:id/lock` |
| [`modules/shareLinks/service.ts`](file:///c:/Users/anany/PriVora/server/src/modules/shareLinks/service.ts) | Share key create / list / revoke / meta / download |
| [`modules/shareLinks/router.ts`](file:///c:/Users/anany/PriVora/server/src/modules/shareLinks/router.ts) | Share link HTTP routes |
| [`realtime/emit.ts`](file:///c:/Users/anany/PriVora/server/src/realtime/emit.ts) | `emit.shareRevoked` + `emit.notify` |
| [`realtime/hardening.ts`](file:///c:/Users/anany/PriVora/server/src/realtime/hardening.ts) | WS: JWT expiry disconnect, origin check, connection cap, rate limit |
| [`nginx/nginx.conf`](file:///c:/Users/anany/PriVora/nginx/nginx.conf) | Nginx reverse-proxy with `limit_req` zones and security headers |
| [`docker-compose.yml`](file:///c:/Users/anany/PriVora/docker-compose.yml) | MinIO ARM64-compatible image (`cleanstart/minio`) |
| [`server/vitest.config.ts`](file:///c:/Users/anany/PriVora/server/vitest.config.ts) | Sequential test file execution; `NODE_ENV=test` |
| [`docs/security-test-report.md`](file:///c:/Users/anany/PriVora/docs/security-test-report.md) | This report |
