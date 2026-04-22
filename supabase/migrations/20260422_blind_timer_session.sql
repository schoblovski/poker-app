-- Add session-level blind timer support to online_spiele
ALTER TABLE online_spiele
  ADD COLUMN IF NOT EXISTS blind_struktur       jsonb        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS blind_level          integer      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blind_timer_running  boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS blind_level_started_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS blind_level_secs_left  integer    DEFAULT NULL;

COMMENT ON COLUMN online_spiele.blind_struktur        IS 'Array of {sb,bb,min} level objects; null = feature disabled';
COMMENT ON COLUMN online_spiele.blind_level           IS 'Current level index (0-based)';
COMMENT ON COLUMN online_spiele.blind_timer_running   IS 'Whether the blind timer is currently counting down';
COMMENT ON COLUMN online_spiele.blind_level_started_at IS 'Wall-clock anchor when running=true; used to compute secsLeft';
COMMENT ON COLUMN online_spiele.blind_level_secs_left  IS 'Remaining seconds frozen at pause time; restored when resuming';
