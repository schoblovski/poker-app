-- Pandemie-Modus Patch – fehlende Spalten in online_spiele
-- Im Supabase SQL Editor ausführen

ALTER TABLE online_spiele
  ADD COLUMN IF NOT EXISTS small_blind  numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS start_stack  numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS video_link   text;

COMMENT ON COLUMN online_spiele.small_blind IS 'Small Blind in Stack-Einheiten';
COMMENT ON COLUMN online_spiele.start_stack IS 'Start-Stack jedes Spielers';
COMMENT ON COLUMN online_spiele.video_link  IS 'Optionaler Link für externen Video-Call (WhatsApp, Meet, FaceTime)';
