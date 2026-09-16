-- 0004_verdict.sql: the verdict screen shows counts, not just rates, and the
-- reveal has two text parts. Store them at compute time so the stored verdict
-- is the whole answer. Forward-only.

ALTER TABLE verdicts ADD COLUMN guess_text        text;
ALTER TABLE verdicts ADD COLUMN guess_days_scored  int;
ALTER TABLE verdicts ADD COLUMN guess_days_correct int;
ALTER TABLE verdicts ADD COLUMN guess_days_unsure  int;
ALTER TABLE verdicts ADD COLUMN days_logged        int;
ALTER TABLE verdicts ADD COLUMN p_value_floor      numeric;
