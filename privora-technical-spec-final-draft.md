# Privora — Technical Design & Build Specification

Secure, room-based, real-time file sharing web application.
Document status: FINAL DRAFT v1.0 (scope: single-instance, Docker Compose, no Redis)

---

## 1. Overview

Privora lets authenticated users create **private rooms**, add other registered users with defined roles, and exchange files inside those rooms. Individual files can also be shared outside a room through **expiring, revocable share keys**. Real-time events (presence, uploads, membership changes, notifications) are delivered over WebSockets; all file bytes move over authenticated HTTPS APIs.

Primary goal: a working, demonstrable application in which every security mechanism is implemented, enforced server-side, and verifiable through automated tests.

### 1.1 In scope
- Registration, login, session management
- Rooms, memberships, role-based permissions
- File upload / download / delete inside rooms
- Share keys for individual files
- Real-time presence and event notifications
- Encryption of files at rest
- Audit logging and a minimal admin view
- Automated security tests and a scan report

### 1.2 Out of scope (v1)
- Redis, horizontal scaling, multi-instance deployments
- Malware scanning (ClamAV), MFA, WAF
- True end-to-end (client-side) encryption
- Native mobile apps (UI is responsive; PWA-ready)
- File preview/editing, folders, versioning, email delivery

(See §15 for how each of these slots in later.)

---

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React (Vite), HTML, CSS | Responsive; access token held in memory only |
| Backend | Node.js 20+, Express, TypeScript | |
| Real-time | Socket.IO (default in-memory adapter) | Single instance; auth at handshake |
| Database | PostgreSQL 15+ via `pg` | Parameterized queries only; migrations via `node-pg-migrate` |
| Object storage | **MinIO** (S3-compatible) via `@aws-sdk/client-s3` | Only ciphertext stored; same code works against AWS S3 |
| Reverse proxy | Nginx | TLS, security headers, body-size limit, coarse `limit_req` |
| Packaging | Docker Compose | 4 services: `nginx`, `api`, `postgres`, `minio` |

Key libraries: `argon2`, `jsonwebtoken` or `jose`, `helmet`, `cors`, `express-rate-limit` (memory store), `zod`, `busboy` or `multer`, `file-type`, `pino`, `socket.io`, `socket.io-client`, `vitest`/`jest`, `supertest`.

### 2.1 Docker services

| Service | Image / build | Exposed | Notes |
|---|---|---|---|
| `nginx` | Multi-stage build: builds the React client, serves it, reverse-proxies `/api` and `/socket.io` | **80/443 only** | The only public entry point |
| `api` | Node 20 slim, non-root user | internal | Express + Socket.IO |
| `postgres` | `postgres:16` | internal | Named volume; app connects with a DML-only role |
| `minio` | `minio/minio` | internal (console bound to `127.0.0.1` in dev only) | Named volume; private bucket |

Networks: `edge` (nginx ↔ api) and `internal` (api ↔ postgres, minio). Postgres and MinIO are never reachable from nginx or the outside. The API creates the bucket on startup if missing (no init container needed). A `docker-compose.dev.yml` override publishes Postgres and MinIO on `127.0.0.1` for local development.

---

## 3. System Architecture

```
                    HTTPS / WSS
 ┌─────────┐   ──────────────────►  ┌──────────────┐
 │ Browser │                        │    Nginx     │  TLS, headers, size limit,
 │ (React) │   ◄──────────────────  │ (+ static UI)│  coarse limit_req
 └─────────┘                        └──────┬───────┘
                                           │  edge network
                                  ┌────────┴─────────┐
                                  │  Node.js API     │
                                  │  Express +       │
                                  │  Socket.IO       │
                                  └───┬──────────┬───┘
                                      │ internal network
                         ┌────────────┘          └─────────────┐
                         ▼                                     ▼
                  ┌─────────────┐                       ┌─────────────┐
                  │ PostgreSQL  │                       │    MinIO    │
                  │ users,rooms,│                       │ (S3 API)    │
                  │ files meta, │                       │ ciphertext  │
                  │ sessions,   │                       │ objects only│
                  │ audit logs  │                       └─────────────┘
                  └─────────────┘
```

### 3.1 Design principles
1. **Server is the only authority.** Every request and socket event is authorized server-side; the client is untrusted.
2. **Deny by default.** Resources a user cannot access return `404`, not `403`, to prevent enumeration.
3. **Opaque identifiers.** UUIDv4 for all IDs; object keys and share keys are random and unrelated to IDs or filenames.
4. **Defense in depth.** Files are validated, encrypted, and stored under a server-generated key; a leak of MinIO reveals nothing useful.
5. **HTTP moves data, WebSockets move signals.** WebSocket payloads never carry file content or secrets.

### 3.2 Single-instance assumptions (no Redis)
- Rate-limit counters, socket rate limits, and presence live in **API process memory**. They reset on restart and are not shared across instances. This is acceptable for v1 because exactly one `api` container runs.
- Anything that must survive restarts is in Postgres: account lockout state (`users.failed_login_count`, `locked_until`), sessions, share-link counters, audit logs.
- Do not scale `api` beyond one replica until Redis is added (§15).

---

## 4. Data Model

### 4.1 Tables

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext UNIQUE NOT NULL,
  username           citext UNIQUE NOT NULL,
  password_hash      text NOT NULL,                 -- argon2id
  global_role        text NOT NULL DEFAULT 'user' CHECK (global_role IN ('user','admin')),
  failed_login_count int  NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_login_at      timestamptz
);

CREATE TABLE sessions (                              -- refresh tokens
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,                       -- rotation chain id
  token_hash   char(64) UNIQUE NOT NULL,            -- SHA-256 of opaque token
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  owner_id   uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_members (
  room_id   uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  added_by  uuid REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_id     uuid NOT NULL REFERENCES users(id),
  original_name   text NOT NULL,                    -- sanitized, metadata only
  storage_key     uuid UNIQUE NOT NULL,             -- server-generated MinIO object name
  detected_type   text NOT NULL,                    -- from magic bytes
  size_bytes      bigint NOT NULL,
  sha256_plain    char(64) NOT NULL,
  enc_iv          bytea NOT NULL,
  enc_tag         bytea NOT NULL,
  dek_wrapped     bytea NOT NULL,                   -- per-file key wrapped by KEK
  kek_version     int NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE share_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES users(id),
  key_hash        char(64) UNIQUE NOT NULL,         -- SHA-256 of the share key
  password_hash   text,                             -- optional, argon2id
  expires_at      timestamptz NOT NULL,
  max_downloads   int,
  download_count  int NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  room_id     uuid,
  outcome     text NOT NULL CHECK (outcome IN ('success','denied','failure')),
  ip          inet,
  user_agent  text,
  metadata    jsonb
);

CREATE INDEX ON room_members (user_id);
CREATE INDEX ON files (room_id) WHERE deleted_at IS NULL;
CREATE INDEX ON share_links (file_id);
CREATE INDEX ON audit_logs (ts DESC);
CREATE INDEX ON audit_logs (actor_id, ts DESC);
```

Presence is **not** stored in the database; it lives in API process memory.

### 4.2 Roles and permissions (RBAC)

Room roles: `owner`, `editor`, `viewer`. Global roles: `user`, `admin`.

| Action | Owner | Editor | Viewer |
|---|:-:|:-:|:-:|
| View room, member list, file list | ✔ | ✔ | ✔ |
| Download files | ✔ | ✔ | ✔ |
| Upload files | ✔ | ✔ | ✘ |
| Delete own file | ✔ | ✔ | ✘ |
| Delete any file | ✔ | ✘ | ✘ |
| Create share link | ✔ (any file) | ✔ (own files) | ✘ |
| Revoke share link | ✔ (any) | ✔ (own) | ✘ |
| Add/remove members, change roles | ✔ | ✘ | ✘ |
| Delete room | ✔ | ✘ | ✘ |

Global `admin`: can view audit logs and lock/unlock accounts. An admin has **no implicit access to room contents or files**.

Enforcement: a single `requireRoomRole(minRole)` middleware loads the caller's membership for `:roomId`, returns `404` if absent and `403` if the role is insufficient. Own-file / own-link checks happen in the service layer.

---

## 5. Core Flows

### 5.1 Registration and login
1. `POST /api/auth/register` — validate, enforce password policy, hash with argon2id, create user.
2. `POST /api/auth/login` — verify credentials (same code path for unknown users), enforce lockout, issue:
   - **Access token** (JWT, 15 min) in the JSON body; the client keeps it **in memory only**.
   - **Refresh token** (opaque, 256-bit random) as `httpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie; SHA-256 hash stored in `sessions`.
3. `POST /api/auth/refresh` — rotates the refresh token: old session revoked, new one issued in the same `family_id`. Presenting an already-revoked token revokes the whole family and logs `session.reuse_detected`.
4. `POST /api/auth/logout` — revokes the session, clears the cookie, disconnects that session's sockets.

### 5.2 Room lifecycle
- **Create:** inserts `rooms` + `owner` membership in one transaction.
- **Add member:** owner supplies the username/email of an **existing** user and a role (`editor`/`viewer`); server inserts membership and emits `member:added`.
- **Change role / remove:** owner only; on removal the user's sockets are forced out of the room immediately (§8.4).
- **Delete room:** owner only; DB rows cascade; the API deletes the room's MinIO objects (best-effort loop, failures logged for retry).

### 5.3 Upload (`POST /api/rooms/:roomId/files`)
1. Auth → `requireRoomRole('editor')`.
2. Rate limit and per-user quota check.
3. Receive multipart upload with a hard **25 MB** cap (v1 buffers in memory so validation completes before anything persists).
4. Sanitize original filename (§7.7).
5. Validate type: extension allowlist + magic-byte detection must agree (§7.7).
6. Compute SHA-256 of plaintext; generate a random `storage_key` (UUID) and a per-file 256-bit DEK.
7. Encrypt with AES-256-GCM (random 96-bit IV); wrap the DEK with the KEK.
8. `PutObject` the ciphertext to MinIO under `storage_key`.
9. Insert `files` row, write audit event, emit `file:uploaded` (metadata only) to `room:{roomId}`.
10. If the DB insert fails after `PutObject`, delete the object (no orphans).

### 5.4 Download (`GET /api/rooms/:roomId/files/:fileId/download`)
1. Auth → `requireRoomRole('viewer')`.
2. Load with `WHERE id = $fileId AND room_id = $roomId AND deleted_at IS NULL` (both IDs checked).
3. `GetObject` ciphertext from MinIO, unwrap DEK, decrypt, **verify the GCM tag before sending any bytes**.
4. Respond with `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename*=UTF-8''<encoded>`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
5. Audit event `file.download`.

The server always proxies downloads because the application owns the encryption. MinIO pre-signed URLs are intentionally **not** used, and the MinIO API is never reachable from the browser.

### 5.5 Share keys
**Create** (`POST /api/rooms/:roomId/files/:fileId/share-links`): Owner, or Editor on own file. Body: `expiresInMinutes` (max 7 days), optional `maxDownloads`, optional `password`.
- Key = `crypto.randomBytes(32)` encoded base64url.
- Only `SHA-256(key)` is stored; the plaintext key is returned **once** in the create response.

**Redeem:**
- `GET /api/s/:key/meta` — filename, size, whether a password is needed. Uniform `404` for unknown, expired, revoked, or exhausted keys.
- `POST /api/s/:key/download` — optional `password`. Server hashes the key, looks up the link, verifies password if set, then **atomically** increments the counter:

```sql
UPDATE share_links
SET download_count = download_count + 1
WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
  AND (max_downloads IS NULL OR download_count < max_downloads)
RETURNING id;
```
Zero rows → deny. This prevents race-condition over-downloading.

---

## 6. API Reference

All endpoints under `/api`, JSON unless noted. Error shape: `{ "error": { "code": "...", "message": "..." } }`.

### Auth
| Method | Path | Auth |
|---|---|---|
| POST | `/auth/register` | none |
| POST | `/auth/login` | none |
| POST | `/auth/refresh` | refresh cookie |
| POST | `/auth/logout` | refresh cookie |
| GET | `/auth/me` | access token |

### Rooms
| Method | Path | Min role |
|---|---|---|
| POST | `/rooms` | any user |
| GET | `/rooms` | any user (own rooms only) |
| GET | `/rooms/:roomId` | viewer |
| DELETE | `/rooms/:roomId` | owner |
| GET | `/rooms/:roomId/members` | viewer |
| POST | `/rooms/:roomId/members` | owner |
| PATCH | `/rooms/:roomId/members/:userId` | owner |
| DELETE | `/rooms/:roomId/members/:userId` | owner (or self to leave) |

### Files
| Method | Path | Min role |
|---|---|---|
| POST | `/rooms/:roomId/files` (multipart) | editor |
| GET | `/rooms/:roomId/files` | viewer |
| GET | `/rooms/:roomId/files/:fileId/download` | viewer |
| DELETE | `/rooms/:roomId/files/:fileId` | editor (own) / owner |

### Share links
| Method | Path | Auth |
|---|---|---|
| POST | `/rooms/:roomId/files/:fileId/share-links` | editor (own file) / owner |
| GET | `/rooms/:roomId/files/:fileId/share-links` | editor (own) / owner |
| DELETE | `/rooms/:roomId/share-links/:linkId` | creator / owner |
| GET | `/s/:key/meta` | public (rate-limited) |
| POST | `/s/:key/download` | public (rate-limited) |

### Admin
| Method | Path | Auth |
|---|---|---|
| GET | `/admin/audit-logs?actor=&action=&from=&to=` | global admin |
| PATCH | `/admin/users/:userId/lock` | global admin |

---

## 7. Security Mechanisms (Specification)

Each mechanism lists the threat, the implementation, and how it is verified.

### 7.1 Password hashing — argon2id
- **Threat:** DB leak leads to offline password cracking.
- **Implementation:** `argon2` package, `argon2id`, `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` (OWASP minimum); unique salt per hash.
- **Policy:** 12–128 characters; reject common passwords (top-N list) or low zxcvbn score.
- **Login hardening:** unknown user and wrong password follow the same path (verify against a dummy hash) and return the identical message `Invalid credentials`.
- **Verify:** equal passwords produce different hashes; unknown-user and wrong-password responses match in body and status.

### 7.2 Token-based authentication — JWT + rotating refresh tokens
- **Threat:** token theft, replay, forged tokens.
- **Access token:** JWT, 15 min, algorithm **pinned** (`HS256` with ≥256-bit secret); claims `sub`, `sid`, `iat`, `exp`, `jti`. Verification rejects `alg: none` and unexpected algorithms.
- **Refresh token:** opaque 256-bit value, stored hashed, rotated on every use, 7-day absolute expiry, reuse detection revokes the whole family (§5.1).
- **Client storage:** access token in JS memory only; refresh token only in the httpOnly cookie. Page reload silently calls `/auth/refresh`.
- **Verify:** expired token, tampered signature, `alg: none`, reused refresh token.

### 7.3 Role-based access control (RBAC)
- **Threat:** privilege escalation inside rooms.
- **Implementation:** matrix in §4.2, enforced by `requireRoomRole` plus service-layer ownership checks. Roles are read from the DB on each request, never trusted from the token.
- **Verify:** parametrized test matrix of every endpoint × every role.

### 7.4 IDOR protection
- **Threat:** accessing others' rooms, files, or links by guessing/modifying IDs.
- **Implementation:**
  - All queries are scoped through membership (`JOIN room_members … WHERE user_id = $caller`).
  - Nested resources always check the parent (`file.room_id = :roomId`).
  - UUIDv4 identifiers; object keys decoupled from file IDs.
  - Non-members and missing resources get the same `404`.
  - Share keys are 256-bit random, looked up by hash.
- **Verify:** user B requests user A's room/file/link with a valid token; a `fileId` from room X used under room Y's route; all return `404`.

### 7.5 Rate limiting and brute-force protection (no Redis)
- **Threat:** credential stuffing, enumeration, resource exhaustion.
- **Two layers:**
  1. **Nginx `limit_req`** (coarse, per IP): a general zone for `/api/` and a tighter zone for `/api/auth/` and `/api/s/`. Cheap protection before requests hit Node.
  2. **`express-rate-limit`** with the default **in-memory store** (fine for a single instance) for the finer limits below.
- **Account lockout** is stored in Postgres so it survives restarts and cannot be bypassed by rotating IPs.

| Scope | Limit |
|---|---|
| Global per IP | 300 requests / 15 min |
| `/auth/login`, `/auth/register` per IP | 10 / 15 min |
| Login per account | 5 consecutive failures → lock 15 min (progressive on repeat), tracked in DB |
| Upload per user | 30 / hour |
| `/s/*` per IP | 30 / 10 min |
| Socket events per connection | 20 events / 10 s (in-memory token bucket), disconnect on repeated violation |

  Responses: `429` with `Retry-After`. Lockouts are audited. Behind Nginx, set `app.set('trust proxy', 1)` so limits key on the real client IP.
- **Note:** `helmet` sets security headers (§7.11); it does **not** provide rate limiting. Rate limiting comes from Nginx and `express-rate-limit`.
- **Verify:** scripted brute-force run gets blocked at the threshold; lockout persists across an API restart.

### 7.6 Input validation and sanitization
- **Threat:** SQL injection, XSS, malformed payloads, mass assignment.
- **Implementation:**
  - `zod` schemas for every body, param, and query; **strict** objects (unknown keys rejected); UUID format enforced on all ID params.
  - Parameterized queries only; no string-built SQL.
  - Text fields (room name, username): trim, Unicode-normalize, strip control characters, enforce length limits.
  - React escapes output; `dangerouslySetInnerHTML` is banned via ESLint.
  - Request body size limits at Nginx and Express.
- **Verify:** injection payloads stored and returned inert; extra JSON fields rejected.

### 7.7 File validation
- **Threat:** disguised executables, stored XSS via uploads, oversize abuse.
- **Implementation:**
  - Size cap 25 MB enforced at Nginx, in the upload parser, and re-checked on the buffer; per-user quota (default 500 MB).
  - **Extension allowlist** (configurable): `pdf, png, jpg, jpeg, webp, gif, txt, csv, md, json, docx, xlsx, pptx, zip`.
  - **Always-blocked** even if allowlisted by mistake: `exe, dll, bat, cmd, sh, js, mjs, html, htm, svg, php, jar, msi, ps1`.
  - **Magic-byte check** with `file-type`; detected type must be consistent with the extension. Plain-text types (no magic bytes) require valid UTF-8 and no NUL bytes in the first chunk.
  - Reject double extensions (`invoice.pdf.exe`) and names that sanitize to empty.
  - Filename sanitization: Unicode NFC, strip path separators and control characters, collapse whitespace, max 255 chars. The sanitized name is **metadata only** and never used in a storage key.
  - Downloads are always `application/octet-stream` + `attachment` + `nosniff`, so uploaded content can never execute in the browser.
- **Verify:** `.exe` renamed to `.png` (magic mismatch), `.html`, `.svg`, oversized file, double-extension name: all rejected.

### 7.8 Path traversal / object-key injection protection
- **Threat:** reading or writing outside the intended storage namespace via `../`, absolute paths, or crafted keys; header injection through filenames.
- **Implementation:**
  - Users never supply a path or key. MinIO object keys are server-generated UUIDs under a fixed prefix (`files/<uuid>`).
  - `StorageAdapter` validates every key against a strict UUID regex before any S3 call and refuses anything else.
  - Original filenames are metadata only, are sanitized (§7.7), and are encoded with RFC 5987 (`filename*=UTF-8''…`) in `Content-Disposition`, so CR/LF or quote injection is impossible.
  - Bucket is private (no anonymous policy); MinIO is on the internal network only.
- **Verify:** adapter unit tests with `../../etc/passwd`, `..%2f`, absolute paths, null bytes; HTTP tests with traversal strings in filename and params; confirm the bucket denies anonymous access.

### 7.9 Secure share keys
Specified in §5.5. Properties: 256-bit CSPRNG key, only a hash stored, shown once, mandatory expiry (max 7 days), optional download cap and password, instant revocation, atomic counter, uniform `404` for all invalid states, dedicated rate limit, full audit trail.

### 7.10 Encryption at rest — envelope encryption
- **Threat:** MinIO volume or backup leak exposes file contents.
- **Implementation:**
  - Per-file random 256-bit **DEK**; file encrypted with **AES-256-GCM**, random 96-bit IV, auth tag stored in DB.
  - DEK wrapped by the **KEK** loaded from `FILE_KEK_V{n}`; `kek_version` stored per file for rotation.
  - Decrypt only after authorization; tag verified before any plaintext is sent.
  - v1 buffers files (≤ 25 MB) for encrypt/decrypt; chunked streaming is a later upgrade.
- **Verify:** the object in MinIO is not a valid PDF/PNG; flip one byte in the object → download fails with an integrity error; wrong KEK → fails.

### 7.11 HTTP hardening — headers (Helmet), CORS, CSRF, TLS
- **Headers (Helmet in Express, mirrored in Nginx for static assets):**
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://<domain>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera, mic, geolocation off), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
  - `X-Powered-By` removed.
- **CORS:** explicit origin allowlist; credentials only for that origin; no wildcards.
- **CSRF:** API calls use the `Authorization` header (not cookies), so they are not CSRF-able. The only cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) use `SameSite=Strict`, require a custom header (`X-Requested-With`), and verify `Origin`.
- **TLS:** terminated at Nginx; `Secure` cookies; HTTP redirected to HTTPS in deployment.
- **Terminology:** call this "security headers and request filtering". It is not a WAF.
- **Verify:** header check, OWASP ZAP baseline scan, CORS test from a disallowed origin, CSRF attempt against refresh.

### 7.12 Audit logging
- **Threat:** undetected abuse, no forensic trail.
- **Events (minimum):** `auth.register`, `auth.login.success/failure`, `auth.lockout`, `session.refresh`, `session.reuse_detected`, `auth.logout`, `room.create/delete`, `member.add/remove/role_change`, `file.upload/upload_rejected/download/delete`, `share.create/redeem/revoke/redeem_denied`, `access.denied`, `admin.lock_user`.
- **Rules:** never log passwords, tokens, share keys, or file contents; `pino` with redaction for `authorization` and `cookie`; the application DB role has `INSERT`/`SELECT` only on `audit_logs`.
- **Verify:** each security test asserts the matching audit row.

### 7.13 WebSocket security
Handshake authentication (§8.2), per-event authorization (§8.3), Origin allowlist, small `maxHttpBufferSize` (10 KB), per-connection event limits, forced disconnect on session revoke or token expiry.

### Mechanism summary (assignment requires ≥ 5)

| # | Mechanism | Section |
|---|---|---|
| 1 | argon2id password hashing + policy | 7.1 |
| 2 | JWT access + rotating refresh tokens | 7.2 |
| 3 | RBAC | 7.3 |
| 4 | IDOR protection | 7.4 |
| 5 | Rate limiting + account lockout | 7.5 |
| 6 | Input validation / sanitization | 7.6 |
| 7 | File validation | 7.7 |
| 8 | Path traversal / object-key protection | 7.8 |
| 9 | Secure share keys | 7.9 |
| 10 | Encryption at rest | 7.10 |
| 11 | Security headers, CORS, CSRF | 7.11 |
| 12 | Audit logging | 7.12 |
| 13 | WebSocket authentication/authorization | 7.13 |

---

## 8. Real-Time Layer (Socket.IO)

### 8.1 What WebSockets are used for
WebSockets are the **signalling channel** for everything that should appear live to people in a room:

- **Presence:** who is online in the room (multi-tab aware)
- **File events:** uploaded, deleted
- **Membership events:** member added, removed, role changed
- **Share events:** share link revoked
- **Personal notifications**
- **Security/session events:** session revoked, room access revoked

Not used for: file bytes, share keys, or state changes. State changes are HTTP requests; the server then broadcasts the result, and clients refetch details over authenticated HTTP.

### 8.2 Connection authentication
- Client connects with `io(url, { auth: { token: accessToken } })` (never in the query string).
- Middleware verifies the JWT (pinned algorithm), checks the session is not revoked, and attaches `socket.data.user`.
- Each user joins a private room `user:{userId}` for personal notifications.
- Tokens expire in 15 min: the server schedules a disconnect at `exp`; the client refreshes and reconnects automatically.

### 8.3 Rooms and authorization
- `room:join { roomId }`: validate UUID, check membership **in the database**, then `socket.join("room:" + roomId)` and reply with `presence:snapshot`. Non-members get a generic error ack.
- Clients cannot emit into rooms; only the server emits room events.

### 8.4 Revocation
On member removal, role change, or session revoke, the HTTP handler calls:
```js
io.in(`user:${userId}`).socketsLeave(`room:${roomId}`);
io.to(`user:${userId}`).emit('room:access_revoked', { roomId });
```
Logout/session revoke also runs `io.in(`user:${userId}`).disconnectSockets()` for the affected session.

### 8.5 Events

| Direction | Event | Payload |
|---|---|---|
| C → S | `room:join` | `{ roomId }` |
| C → S | `room:leave` | `{ roomId }` |
| S → C | `presence:snapshot` | `{ roomId, users: [{ userId, username }] }` |
| S → C | `presence:update` | `{ roomId, userId, username, status: 'online' \| 'offline' }` |
| S → C | `file:uploaded` | `{ roomId, file: { id, name, size, uploaderId, createdAt } }` |
| S → C | `file:deleted` | `{ roomId, fileId, deletedBy }` |
| S → C | `member:added` / `member:removed` / `member:role_changed` | `{ roomId, userId, role? }` |
| S → C | `share:revoked` | `{ roomId, fileId, linkId }` |
| S → C | `notification:new` | `{ id, type, message, createdAt }` |
| S → C | `room:access_revoked` | `{ roomId }` |
| S → C | `session:revoked` | `{}` |

### 8.6 Presence implementation
In-memory `Map<roomId, Map<userId, Set<socketId>>>`. A user is `online` while their socket set is non-empty (handles multiple tabs); `presence:update` fires only on 0→1 and 1→0 transitions. On `disconnect`, all of the socket's rooms are cleaned up. This is single-instance only (§3.2).

### 8.7 Limits
`maxHttpBufferSize: 10_000`, 20 events / 10 s per socket, connection cap per user (e.g. 10), default ping settings.

---

## 9. Frontend Specification

- **Routes:** `/login`, `/register`, `/rooms`, `/rooms/:roomId` (files, members, presence), `/s/:key` (public share page), `/admin/audit` (admin only).
- **State:** access token in memory; silent refresh on load and on `401`; a single in-flight refresh promise to avoid races.
- **Socket hook:** connects after login, joins the current room, applies events to local state, tears down on logout or `room:access_revoked`.
- **Upload UI:** client-side pre-checks (size, extension) for UX only; the server is authoritative. Progress via XHR/axios progress events.
- **Share UI:** the key/URL is shown **once** with a copy button and a notice that it can't be shown again.
- **Hygiene:** no `dangerouslySetInnerHTML`, no tokens in storage, CSP-compatible build (no inline scripts), responsive layout.

---

## 10. Project Structure

```
privora/
├── docker-compose.yml
├── docker-compose.dev.yml          # publishes postgres/minio on 127.0.0.1 for local dev
├── .env.example
├── nginx/
│   ├── Dockerfile                  # multi-stage: build client → nginx
│   └── nginx.conf
├── server/
│   ├── Dockerfile
│   ├── src/
│   │   ├── app.ts                  # express app, middleware order
│   │   ├── server.ts               # http + socket bootstrap, ensureBucket()
│   │   ├── config/                 # env parsing (zod), constants
│   │   ├── db/
│   │   │   ├── pool.ts
│   │   │   └── migrations/
│   │   ├── middleware/
│   │   │   ├── auth.ts             # JWT verify
│   │   │   ├── rbac.ts             # requireRoomRole
│   │   │   ├── rateLimit.ts        # express-rate-limit (memory store)
│   │   │   ├── validate.ts         # zod wrapper
│   │   │   ├── csrf.ts             # origin + custom header check
│   │   │   └── errorHandler.ts
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── rooms/
│   │   │   ├── files/
│   │   │   ├── shareLinks/
│   │   │   ├── admin/
│   │   │   └── audit/
│   │   ├── realtime/
│   │   │   ├── socket.ts           # auth middleware, handlers
│   │   │   ├── presence.ts
│   │   │   └── emit.ts             # typed emit helpers used by services
│   │   ├── storage/
│   │   │   ├── StorageAdapter.ts   # put/get/delete + key validation
│   │   │   └── S3Adapter.ts        # MinIO via @aws-sdk/client-s3 (forcePathStyle)
│   │   ├── crypto/
│   │   │   ├── password.ts         # argon2id
│   │   │   ├── tokens.ts           # JWT, refresh, share keys
│   │   │   └── fileCrypto.ts       # envelope encryption
│   │   └── utils/                  # filename sanitizer, file-type check
│   └── tests/
│       ├── auth.test.ts
│       ├── rbac.matrix.test.ts
│       ├── idor.test.ts
│       ├── upload-validation.test.ts
│       ├── storage-keys.test.ts
│       ├── share-links.test.ts
│       ├── ratelimit.test.ts
│       ├── crypto.test.ts
│       └── socket.test.ts
├── client/
│   └── src/ (pages, components, hooks/useSocket, api/, auth/)
└── docs/
    └── security-test-report.md
```

Middleware order in `app.ts`: `helmet` → CORS → request ID + `pino-http` → body size limits → global rate limiter → cookie parser → CSRF/origin guard (cookie routes) → routes (each with its own limiter, `auth`, `validate`, `rbac`) → 404 → `errorHandler`.

---

## 11. Configuration

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API port |
| `DATABASE_URL` | Postgres connection string (least-privilege app role) |
| `ACCESS_TOKEN_SECRET` | ≥ 32 random bytes |
| `ACCESS_TOKEN_TTL` | default `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | default `7` |
| `FILE_KEK_V1` | base64 32-byte key-encryption key |
| `FILE_KEK_CURRENT_VERSION` | integer |
| `S3_ENDPOINT` | e.g. `http://minio:9000` |
| `S3_BUCKET` | private bucket name |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | MinIO credentials (non-default, random) |
| `S3_REGION` | e.g. `us-east-1` (required by SDK) |
| `CORS_ORIGIN` | exact frontend origin |
| `MAX_UPLOAD_BYTES` | default 26214400 |
| `USER_QUOTA_BYTES` | default 524288000 |
| `POSTGRES_USER/PASSWORD/DB` | for the `postgres` service |

Secrets are never committed; `.env.example` holds placeholders only. Startup fails fast if a required secret is missing or too short, or if MinIO credentials equal the defaults.

Database roles: one migration role (DDL), one application role (DML only; no `UPDATE`/`DELETE` on `audit_logs`).

---

## 12. Testing & Verification Plan

### 12.1 Automated security tests (each also asserts an audit row where applicable)

| Attack / check | Expected result |
|---|---|
| Brute-force login (> 5 attempts) | `429` / account locked |
| Lockout after API restart | still locked (DB-backed) |
| Unknown user vs wrong password | identical response body and status |
| Expired / tampered / `alg:none` JWT | `401` |
| Reused refresh token | `401`, session family revoked |
| User B accesses user A's room/file/link | `404` |
| File ID from room X used under room Y path | `404` |
| Viewer attempts upload/delete/member add | `403` |
| Editor deletes another's file | `403` |
| Upload renamed `.exe` as `.png` | rejected |
| Upload `.html`, `.svg`, oversized file, `a.pdf.exe` | rejected |
| Traversal in filename/params (`../`, `..%2f`, null byte) | rejected, no storage access |
| Non-UUID key passed to `StorageAdapter` | throws |
| Anonymous request to MinIO bucket | denied |
| Expired / revoked / exhausted / wrong-password share key | uniform `404`/`403` |
| 50 concurrent redeems on `max_downloads = 1` | exactly 1 succeeds |
| Tampered ciphertext in MinIO | download fails (integrity error) |
| SQLi / XSS payloads in text fields | stored inert |
| Socket connect without/invalid token | refused |
| Socket `room:join` for non-member room | refused, no events received |
| Member removed while connected | receives `room:access_revoked`, no further events |
| Socket event flood | disconnected |
| CORS from disallowed origin / CSRF on refresh | blocked |

### 12.2 Tooling
- `vitest`/`jest` + `supertest` for HTTP; `socket.io-client` for realtime tests; tests run against real Postgres and MinIO containers.
- **OWASP ZAP baseline scan** against the running Compose stack; report saved in `docs/`.
- `npm audit` with the lockfile committed.
- Manual demo script: run each attack from the table and show the defense.

---

## 13. Implementation Order

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Repo scaffold, Compose (nginx, api, postgres, minio), env validation, `ensureBucket` | `docker compose up` brings up a healthy empty stack |
| 1 | Migrations, register/login/refresh/logout, argon2id, JWT, DB-backed lockout | auth tests pass |
| 2 | Rooms, memberships, RBAC middleware, IDOR-safe queries | RBAC matrix + IDOR tests pass |
| 3 | `StorageAdapter`/MinIO, upload validation, encryption, download | upload/download, validation, key-injection, crypto tests pass |
| 4 | Share keys (create, meta, redeem, revoke) | share-link tests incl. race test pass |
| 5 | Socket.IO gateway, presence, room events, revocation | socket tests pass |
| 6 | Helmet/CSP/CORS/CSRF, rate limits (Nginx + express-rate-limit), audit logging, admin view | header checks + rate-limit tests pass |
| 7 | React UI for all flows, responsive layout | manual end-to-end run through all features |
| 8 | ZAP scan, test report, Nginx TLS config, deploy notes | `docs/security-test-report.md` complete |

---

## 14. Deployment Notes

- Nginx terminates TLS, redirects HTTP→HTTPS, sets `client_max_body_size 26m`, proxies `/api` and `/socket.io` (with WebSocket upgrade headers), serves the built client, and applies `limit_req` zones.
- Only Nginx publishes ports. Postgres and MinIO exist solely on the internal Docker network.
- `api` runs as a non-root user; run one replica only (§3.2).
- MinIO: private bucket, no anonymous policy, non-default credentials, console not published in production.
- Secrets come from environment / Docker secrets; rotate `ACCESS_TOKEN_SECRET` and the KEK using versioning.
- Cookies require HTTPS (`Secure`); browsers exempt `localhost` for development.
- Named volumes for Postgres and MinIO; document a backup approach (e.g. `pg_dump` + `mc mirror`).

---

## 15. Later Extensions (post-v1)

1. **Redis:** shared rate-limit store (`rate-limit-redis`), Socket.IO Redis adapter, presence in Redis with TTL heartbeats → enables running multiple `api` replicas.
2. ClamAV malware scanning before encryption (`clamd` `INSTREAM`).
3. TOTP-based MFA with recovery codes.
4. Chunked AEAD streaming for large files.
5. ModSecurity + OWASP CRS in front of Nginx (a genuine WAF layer).
6. True end-to-end encryption using the Web Crypto API.
7. Anomaly alerts over WebSockets; soft-delete with scheduled purge.

---

## 16. Definition of Done

- All endpoints in §6 implemented and covered by tests.
- Every mechanism in §7 implemented, with its verification from §12 passing.
- No endpoint or socket event reachable without server-side authorization.
- Only ciphertext present in MinIO; plaintext keys/tokens never logged or persisted.
- ZAP baseline report shows no high-severity findings (or each is documented and mitigated).
- The full stack runs from `docker compose up` with documented setup steps.
