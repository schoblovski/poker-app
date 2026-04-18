-- Pandemie-Modus: REPLICA IDENTITY FULL für korrekte Realtime-Events + big_blind Feld

-- REPLICA IDENTITY FULL: nötig damit UPDATE/DELETE Events mit Column-Filtern funktionieren
ALTER TABLE online_spiele  REPLICA IDENTITY FULL;
ALTER TABLE online_seats   REPLICA IDENTITY FULL;
ALTER TABLE online_actions REPLICA IDENTITY FULL;

-- big_blind: separat konfigurierbar (Default = small_blind * 2 wenn NULL)
ALTER TABLE online_spiele ADD COLUMN IF NOT EXISTS big_blind numeric;
COMMENT ON COLUMN online_spiele.big_blind IS 'Big Blind; NULL = small_blind * 2';

NOTIFY pgrst, 'reload schema';
