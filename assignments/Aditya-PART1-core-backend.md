# Privora — Part 1: Core Backend

**Owner:** Adi
**Reference:** `docs/SPEC.md` (the final-draft technical spec). This doc only says *who builds what*. Behaviour, schemas, and security details live in the spec.

## Team split at a glance

| Part | Owner | Scope |
|---|---|---|
| 1 Core backend | Adi | Scaffold, DB, auth, rooms/RBAC/IDOR, file pipeline + validation + storage, base WebSocket |
| 2 Frontend | (name) | React app, API + socket client, UI for all flows, client build, final report |
| 3 Security add-ons | (name) | Headers/CORS/CSRF, rate limiting, audit + admin, encryption at rest, share keys, WS hardening, security tests + ZAP |

## Ground rules (same in all three docs)
- **Folder ownership.** Only edit folders your part owns. Need a change elsewhere → open a PR/issue to the owner.
- **Branches.** `feature/p<part>-<topic>` → PR into `main`. Part 1 reviews any backend PR touching auth, files, or storage.
- **Frozen contracts** (changes need a PR + a heads-up): DB schema (spec §4.1), API (§6), WebSocket events (§8.5), and the stub interfaces below.
- New env vars go in `.env.example` in the same PR.
- Never log or commit secrets, tokens, or share keys.

## Stub interfaces Part 1 creates in Phase 0 (so others never block)

| Interface | File | Part 1 stub | Real implementation by |
|---|---|---|---|
| `audit.log({actorId, action, targetType?, targetId?, roomId?, outcome, ip, userAgent, metadata?})` | `modules/audit/audit.ts` | logs via pino only | Part 3 (DB insert) |
| `fileCrypto.encrypt(buf) → {ciphertext, iv, tag, dekWrapped, kekVersion}` / `fileCrypto.decrypt(...) → Buffer` (throws on tag failure) | `crypto/fileCrypto.ts` | **dev-only passthrough**, loudly marked | Part 3 |
| `applySecurity(app)` (helmet, CORS, CSRF guard) | `middleware/security.ts` | no-op | Part 3 |
| `limiters.{global,auth,upload,share}` | `middleware/rateLimit.ts` | pass-through middleware | Part 3 |
| `emit.*` typed helpers | `realtime/emit.ts` | real (Part 1 defines) | Part 3 adds `shareRevoked`, `notify` |
| `filesService.getDecryptedForShare(fileId) → {name, size, buffer}` (no auth check; caller authorizes) | `modules/files/` | real, by Part 1 once the pipeline exists | n/a (consumed by Part 3 share keys) |

Part 1 wires these into `app.ts` in the correct order (spec §10) so Parts 2 and 3 never edit `app.ts`.

## Part 1 owns (folders)
`server/src/{app.ts, server.ts, config, db, middleware/{auth,rbac,validate,errorHandler}, modules/{auth,rooms,files}, realtime/{socket,presence,emit}, storage, utils}`, `docker-compose*.yml`, `.env.example`, migrations.

## Task list

### Phase 0 — Scaffold (do first, fast)
- [x] Repo layout per spec §10; TypeScript, ESLint, vitest/jest config.
- [x] Compose: `nginx`, `api`, `minio`. **Postgres runs on the host** (not in Compose). Point `DATABASE_URL` at it; from the `api` container use `host.docker.internal` (add `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux), or run `api` natively in dev.
- [x] Env parsing with zod, fail-fast on missing/short secrets and default MinIO credentials.
- [x] **All migrations** for every table in spec §4.1 (freezes the schema for everyone on day one).
- [x] `ensureBucket()` on startup; private bucket.
- [x] All stub interfaces above; central error handler; pino logging with redaction.
- [x] Post to the team: "contracts frozen".

### Phase 1 — Auth (spec §5.1, §7.1, §7.2, lockout part of §7.5)
- [x] register / login / refresh / logout / me
- [x] argon2id + password policy + dummy-hash login path
- [x] JWT (pinned alg), opaque refresh tokens hashed in DB, rotation, family reuse detection
- [x] DB-backed lockout (`failed_login_count`, `locked_until`)
- [x] `auth` middleware
- [x] Tests: `auth.test.ts`

### Phase 2 — Rooms, RBAC, IDOR, validation (spec §4.2, §5.2, §7.3, §7.4, §7.6)
- [x] Rooms + members endpoints, owner transaction
- [x] `requireRoomRole`, membership-scoped queries, `404` for non-members
- [x] zod `validate` middleware (strict objects, UUID params), text-field normalization
- [x] Tests: `rbac.matrix.test.ts`, `idor.test.ts`
- [x] **Publish `docs/API_EXAMPLES.md`** (sample request/response per endpoint) as endpoints land, so Part 2 can integrate.

### Phase 3 — File pipeline (spec §5.3, §5.4, §7.7, §7.8)
- [x] Multipart upload with 25 MB cap, per-user quota
- [x] Filename sanitizer, allowlist/blocklist, double-extension rejection, magic-byte check, text-file checks
- [x] `StorageAdapter` + `S3Adapter` (MinIO, `forcePathStyle`), strict UUID key validation
- [x] Upload flow calling `fileCrypto.encrypt`, orphan cleanup on DB failure
- [x] Download flow calling `fileCrypto.decrypt`, safe headers, `Content-Disposition` encoding
- [x] `filesService.getDecryptedForShare`
- [x] Soft delete + MinIO object removal; room-delete cleanup
- [x] Tests: `upload-validation.test.ts`, `storage-keys.test.ts`

### Phase 4 — Base WebSocket (spec §8.1–8.6)
- [x] Handshake JWT auth, `user:{id}` room
- [x] `room:join/leave` with DB membership check
- [x] In-memory presence with multi-tab handling, `presence:snapshot/update`
- [x] `emit.ts` helpers; emit `file:uploaded`, `file:deleted`, `member:*` from services
- [x] Revocation: `socketsLeave` + `room:access_revoked` on member removal/role change, `disconnectSockets` on logout
- [x] Tests: `socket.test.ts` (auth, non-member join refused, revocation)

*Part 3 later adds:* token-expiry disconnect, Origin allowlist, socket rate limit, `notification:new`, `share:revoked`.

## Handoff checkpoints
1. **End of Phase 0:** contracts frozen; Parts 2 and 3 can start.
2. **End of Phase 2:** auth + rooms live, API examples published (Part 2 swaps mocks for real API).
3. **End of Phase 3:** Part 3 can build share keys and finish encryption against the real pipeline.
4. **End of Phase 4:** Part 2 wires live presence/events.

## Done when
Every Part 1 checkbox is ticked, its tests pass, and nothing in these modules trusts client input, role claims, or filenames.
