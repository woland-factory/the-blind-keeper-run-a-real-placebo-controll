-- 0002_experiment_immutability.sql: seal a pre-registered design at the database.
-- Once pre_registered_at is set, the frozen columns can never change. Later
-- epics still need to advance status and set the calendar dates, so those three
-- columns stay writable. Forward-only.

CREATE OR REPLACE FUNCTION freeze_pre_registered_experiment()
RETURNS trigger AS $$
BEGIN
  IF OLD.pre_registered_at IS NOT NULL THEN
    IF NEW.id                IS DISTINCT FROM OLD.id
       OR NEW.user_id           IS DISTINCT FROM OLD.user_id
       OR NEW.substance_name    IS DISTINCT FROM OLD.substance_name
       OR NEW.metric_name       IS DISTINCT FROM OLD.metric_name
       OR NEW.metric_type       IS DISTINCT FROM OLD.metric_type
       OR NEW.metric_direction  IS DISTINCT FROM OLD.metric_direction
       OR NEW.block_length_days IS DISTINCT FROM OLD.block_length_days
       OR NEW.num_blocks        IS DISTINCT FROM OLD.num_blocks
       OR NEW.num_active_blocks IS DISTINCT FROM OLD.num_active_blocks
       OR NEW.washout_note      IS DISTINCT FROM OLD.washout_note
       OR NEW.pre_registered_at IS DISTINCT FROM OLD.pre_registered_at
       OR NEW.created_at        IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'experiment is pre-registered and cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER experiments_freeze_pre_registered
  BEFORE UPDATE ON experiments
  FOR EACH ROW
  EXECUTE FUNCTION freeze_pre_registered_experiment();
