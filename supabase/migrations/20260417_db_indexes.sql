-- DTKS Poker – DB-Performance-Indizes (Sprint 1: DB Foundation)
-- Datum: 2026-04-17
--
-- Ziel: Häufige Queries (Verlauf, Statistik, Spieler-Detail, Login, Push)
-- spürbar beschleunigen, sobald Datenmenge wächst.
--
-- Alle Indizes sind IF NOT EXISTS – Script ist idempotent und gefahrlos
-- mehrfach ausführbar. Risiko praktisch null (nur Lese-Speedup, Write-Overhead
-- bei <1000 Zeilen/Tag vernachlässigbar).

-- ─────────────────────────────────────────────────────────────
-- spiel_teilnehmer  (am häufigsten gejoined)
-- ─────────────────────────────────────────────────────────────
-- Join auf Spiel-Detail, Spiel-Abschluss, Spiel verwerfen
CREATE INDEX IF NOT EXISTS idx_spiel_teilnehmer_spiel_id
  ON spiel_teilnehmer(spiel_id);

-- Spieler-Stats: alle Spiele eines Spielers
CREATE INDEX IF NOT EXISTS idx_spiel_teilnehmer_spieler_id
  ON spiel_teilnehmer(spieler_id);

-- Kombi-Index für "Teilnehmer eines Spielers in einem Spiel"
-- (verhindert Duplikate + beschleunigt Upsert-Checks)
CREATE INDEX IF NOT EXISTS idx_spiel_teilnehmer_spiel_spieler
  ON spiel_teilnehmer(spiel_id, spieler_id);

-- ─────────────────────────────────────────────────────────────
-- transaktionen  (Konto-Screen, Spieler-Stats, Jahresspende)
-- ─────────────────────────────────────────────────────────────
-- Chronologische Sortierung (Konto-Screen, Verlauf)
CREATE INDEX IF NOT EXISTS idx_transaktionen_datum
  ON transaktionen(datum DESC);

-- Spieler-Stats: Transaktionen eines Spielers
CREATE INDEX IF NOT EXISTS idx_transaktionen_von_spieler
  ON transaktionen(von_spieler_id)
  WHERE von_spieler_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaktionen_nach_spieler
  ON transaktionen(nach_spieler_id)
  WHERE nach_spieler_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- hand_statistik  (Hände-Screen, Spieler-Stats, Statistik)
-- ─────────────────────────────────────────────────────────────
-- Hände eines Gewinners (Spieler-Stats)
CREATE INDEX IF NOT EXISTS idx_hand_statistik_gewinner
  ON hand_statistik(gewinner_id);

-- Hände eines Spielabends (Spiel-Detail)
CREATE INDEX IF NOT EXISTS idx_hand_statistik_spiel
  ON hand_statistik(spiel_id)
  WHERE spiel_id IS NOT NULL;

-- Chronologische Sortierung (Hände-Screen)
CREATE INDEX IF NOT EXISTS idx_hand_statistik_datum
  ON hand_statistik(datum DESC);

-- ─────────────────────────────────────────────────────────────
-- spiele  (viele Queries filtern auf abgeschlossen=true/false)
-- ─────────────────────────────────────────────────────────────
-- Abgeschlossene Spiele chronologisch (Verlauf, Statistik)
CREATE INDEX IF NOT EXISTS idx_spiele_abgeschlossen_datum
  ON spiele(abgeschlossen, datum DESC);

-- ─────────────────────────────────────────────────────────────
-- spieler  (Login, aktive Spielerliste)
-- ─────────────────────────────────────────────────────────────
-- Login-Lookup (aktiv=true ist Voraussetzung)
CREATE INDEX IF NOT EXISTS idx_spieler_email_aktiv
  ON spieler(email, aktiv);

-- Aktive Spielerliste (Home, Spielerverwaltung, Statistik)
CREATE INDEX IF NOT EXISTS idx_spieler_aktiv
  ON spieler(aktiv)
  WHERE aktiv = true;

-- ─────────────────────────────────────────────────────────────
-- push_subscriptions  (Push Notifications, Admin-Übersicht)
-- ─────────────────────────────────────────────────────────────
-- Subscriptions eines Spielers (Profil, Admin-Übersicht)
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_spieler
  ON push_subscriptions(spieler_id);

-- ─────────────────────────────────────────────────────────────
-- Analyse: nach Ausführung ANALYZE laufen lassen, damit der Planer
-- die neuen Statistiken nutzt.
-- ─────────────────────────────────────────────────────────────
ANALYZE spiel_teilnehmer;
ANALYZE transaktionen;
ANALYZE hand_statistik;
ANALYZE spiele;
ANALYZE spieler;
ANALYZE push_subscriptions;
