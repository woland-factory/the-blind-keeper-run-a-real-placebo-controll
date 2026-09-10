-- 0001_init.sql: core schema for blind-keeper.
-- Forward-only. Never edit an applied migration; add a new one.

CREATE EXTENSION IF NOT EXISTS citext;

-- Accounts. Email is case-insensitive and unique.
CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      citext UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Single-use, short-lived magic-link tokens. Only the SHA-256 hash is stored;
-- the raw token is never persisted.
CREATE TABLE magic_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_tokens_token_hash_idx ON magic_tokens (token_hash);

-- Server-side sessions. The signed cookie carries only the session id.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Experiments. Everything above pre_registered_at becomes immutable once locked
-- (enforced by later epics; this epic only creates the table).
CREATE TABLE experiments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  substance_name    text,
  metric_name       text,
  metric_type       text,
  metric_direction  text,
  block_length_days int,
  num_blocks        int,
  num_active_blocks int,
  washout_note      text,
  status            text NOT NULL,
  pre_registered_at timestamptz,
  start_date        date,
  planned_end_date  date,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiments_user_id_idx ON experiments (user_id);

-- SECRET: allocations map codes to conditions and days. This table must never
-- be included in any API response before unblinding. See db/index.ts invariant.
CREATE TABLE allocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id    uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  block_index      int,
  code             text,
  condition        text,
  block_start_date date,
  block_end_date   date
);
CREATE INDEX allocations_experiment_id_idx ON allocations (experiment_id);

-- One check-in per experiment per day.
CREATE TABLE check_ins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  check_date    date NOT NULL,
  metric_value  numeric,
  note          text,
  placebo_guess text,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, check_date)
);

-- One verdict per experiment, created at unblinding.
CREATE TABLE verdicts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id            uuid NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
  effect_estimate          numeric,
  effect_units             text,
  permutation_p_value      numeric,
  guess_accuracy           numeric,
  guess_p_value_vs_chance  numeric,
  adherence_pct            numeric,
  blind_integrity_flag     boolean,
  power_note               text,
  verdict_text             text,
  computed_at              timestamptz NOT NULL DEFAULT now()
);
