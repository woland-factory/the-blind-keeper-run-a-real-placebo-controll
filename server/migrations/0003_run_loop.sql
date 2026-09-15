-- 0003_run_loop.sql: the running loop needs a permanent void marker, a reminder
-- debounce guard, and an index for the status-filtered sweeps. Forward-only.

-- Permanent record that the user broke the blind. Not in the frozen-column set,
-- so the immutability trigger allows writing it. NULL until break-blind.
ALTER TABLE experiments ADD COLUMN broke_blind_at timestamptz;

-- One reminder per user per calendar day. The UNIQUE constraint is the debounce:
-- a second insert for the same (user, day) is a no-op, so reminders never storm
-- no matter how often the sweep runs.
CREATE TABLE reminder_sends (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  send_date date NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, send_date)
);

-- The dashboard and the reminder sweep both filter experiments by status.
CREATE INDEX experiments_status_idx ON experiments (status);
