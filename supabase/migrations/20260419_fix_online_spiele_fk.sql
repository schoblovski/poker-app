-- Fix FK online_spiele.spiel_id: CASCADE → SET NULL
-- Damit beim Löschen eines spiele-Eintrags die Online-Session in der Lobby erhalten bleibt.
-- Admin entscheidet selbst wann eine abgeschlossene Session verschwindet.
ALTER TABLE online_spiele DROP CONSTRAINT IF EXISTS online_spiele_spiel_id_fkey;
ALTER TABLE online_spiele ADD CONSTRAINT online_spiele_spiel_id_fkey
  FOREIGN KEY (spiel_id) REFERENCES spiele(id) ON DELETE SET NULL;
