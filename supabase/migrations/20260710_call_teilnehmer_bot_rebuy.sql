-- Online-Modus: fehlende online_spiele-Spalten ergänzen + P-Wort aus Tabellen-Kommentar entfernen
--
-- Kontext: Der Client (index.html) schrieb bereits auf zwei online_spiele-Spalten,
-- die in der DB nie angelegt wurden:
--   * call_teilnehmer  – Video-Call "im Call"-Tracking (btn-pm-call)
--   * bot_auto_rebuy    – Bot-Auto-Rebuy-Toggle (Session-Einstellungen);
--                         poker-new-hand liest session.bot_auto_rebuy !== false

ALTER TABLE online_spiele
  ADD COLUMN IF NOT EXISTS call_teilnehmer jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN online_spiele.call_teilnehmer IS 'Spieler-IDs die aktuell im Video-Call sind (Join/Leave-Tracking)';

ALTER TABLE online_spiele
  ADD COLUMN IF NOT EXISTS bot_auto_rebuy boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN online_spiele.bot_auto_rebuy IS 'Ob Bots nach dem Ausscheiden automatisch nachkaufen (Standard: true)';

-- P-Wort aus dem Tabellen-Kommentar entfernen (Terminologie: durchgängig "Online-Modus")
COMMENT ON TABLE online_spiele IS 'Online-Modus: Spielzustand (sichtbar für alle Teilnehmer)';
