-- DTKS Poker – Blind-Timer Standard-Struktur (DB-Tabelle)
-- Datum: 2026-04-17
--
-- Ziel: Admin-konfigurierbare Default-Blind-Levels für den Blind-Timer.
-- Spieler bekommen diese Levels beim ersten Öffnen des Timers
-- vorgeschlagen. Lokale Anpassungen bleiben in localStorage.
--
-- Idempotent: Re-Run löscht/ersetzt die Default-Seed-Daten nicht,
-- nur das Tabellen-Setup.

-- ─────────────────────────────────────────────────────────────
-- Tabelle
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blind_struktur (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  level_nr     integer     NOT NULL UNIQUE CHECK (level_nr > 0),
  small_blind  integer     NOT NULL        CHECK (small_blind > 0),
  big_blind    integer     NOT NULL        CHECK (big_blind > 0),
  ante         integer     NOT NULL DEFAULT 0 CHECK (ante >= 0),
  dauer_min    integer     NOT NULL        CHECK (dauer_min > 0),
  erstellt_am  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blind_struktur_level ON blind_struktur(level_nr);

-- ─────────────────────────────────────────────────────────────
-- RLS
-- Alle authentifizierten Nutzer dürfen lesen/schreiben (Admin-Check
-- erfolgt clientseitig, wie bei einstellungen/spieler). Passt zum
-- bisherigen Sicherheitsmodell der App.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE blind_struktur ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blind_struktur_all" ON blind_struktur;
CREATE POLICY "blind_struktur_all" ON blind_struktur
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────
-- Seed: Standard-Levels (nur wenn Tabelle leer ist)
-- ─────────────────────────────────────────────────────────────
INSERT INTO blind_struktur (level_nr, small_blind, big_blind, ante, dauer_min)
SELECT * FROM (VALUES
  ( 1,   25,    50,   0, 15),
  ( 2,   50,   100,   0, 15),
  ( 3,   75,   150,   0, 15),
  ( 4,  100,   200,   0, 15),
  ( 5,  150,   300,   0, 15),
  ( 6,  200,   400,   0, 15),
  ( 7,  300,   600,   0, 15),
  ( 8,  400,   800,   0, 15),
  ( 9,  500,  1000,   0, 20),
  (10,  750,  1500,   0, 20),
  (11, 1000,  2000, 200, 20),
  (12, 1500,  3000, 300, 20)
) AS s(level_nr, small_blind, big_blind, ante, dauer_min)
WHERE NOT EXISTS (SELECT 1 FROM blind_struktur);

-- Kontrolle (optional):
-- SELECT * FROM blind_struktur ORDER BY level_nr;
