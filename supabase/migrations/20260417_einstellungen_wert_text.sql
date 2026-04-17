-- DTKS Poker – einstellungen.wert auf TEXT erweitern
-- Datum: 2026-04-17
--
-- Grund: Der Blind-Timer speichert seine Standard-Struktur als JSON
-- unter key='blind_levels_default' in der einstellungen-Tabelle.
-- Falls die wert-Spalte als numeric angelegt wurde, würde das INSERT
-- fehlschlagen.
--
-- Idempotent: wenn wert schon text ist, ist das ein No-Op (der USING-Cast
-- funktioniert in beide Richtungen).

DO $$
BEGIN
  -- Nur alter, wenn die Spalte noch nicht text ist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='einstellungen'
      AND column_name='wert'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE einstellungen ALTER COLUMN wert TYPE text USING wert::text;
  END IF;
END$$;
