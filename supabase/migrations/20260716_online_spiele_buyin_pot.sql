-- N2 (Paket 8): Buy-In-Faktor (Chip-Euro-Kurs) als Snapshot pro Online-Session.
-- Gleiche Fehlerklasse wie K3 bei Cash-Spielen: bisher hing der Kurs an den GLOBALEN
-- Einstellungen zum jeweiligen Zeitpunkt (Kauf vs. Abrechnung konnten auseinanderlaufen,
-- wenn der Admin buyin_pot während einer laufenden Session änderte).
-- Neue Sessions schreiben den aktuellen einstellungen.buyin_pot beim Erstellen mit.
-- Bestehende Sessions bleiben NULL → Client-Fallback auf einstellungen.buyin_pot.
ALTER TABLE online_spiele ADD COLUMN IF NOT EXISTS buyin_pot numeric;
COMMENT ON COLUMN online_spiele.buyin_pot IS 'Chip-Euro-Kurs-Snapshot beim Session-Start (Euro pro Buy-In). NULL bei Alt-Sessions → Client-Fallback auf einstellungen.buyin_pot.';
