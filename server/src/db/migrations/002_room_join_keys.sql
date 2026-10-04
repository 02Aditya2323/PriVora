-- Migration 002: Room Join Keys (Cryptographic Room Invite & Access Keys)

CREATE TABLE IF NOT EXISTS room_join_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES users(id),
  key_hash        char(64) UNIQUE NOT NULL,         -- SHA-256 of the unguessable join key
  role            text NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor', 'viewer')),
  password_hash   text,                             -- optional, argon2id
  expires_at      timestamptz NOT NULL,
  max_uses        int,                              -- optional usage cap (e.g. 1 for single-use)
  use_count       int NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_join_keys_room_id ON room_join_keys (room_id);
CREATE INDEX IF NOT EXISTS idx_room_join_keys_key_hash ON room_join_keys (key_hash);
