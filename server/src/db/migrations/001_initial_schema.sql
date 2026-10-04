-- Privora Database Schema - Initial Migration (Spec §4.1)

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS sessions (                              -- refresh tokens
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

CREATE TABLE IF NOT EXISTS rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  owner_id   uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id   uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  added_by  uuid REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
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

CREATE TABLE IF NOT EXISTS share_links (
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

CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members (user_id);
CREATE INDEX IF NOT EXISTS idx_files_room_active ON files (room_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_share_links_file_id ON share_links (file_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_ts ON audit_logs (actor_id, ts DESC);
