-- DTKS Poker – Push Subscriptions Tabelle
-- Im Supabase SQL Editor ausführen (einmalig)
-- Dashboard → SQL Editor → New Query → Paste → Run

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spieler_id   uuid NOT NULL REFERENCES spieler(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  -- Benachrichtigungs-Einstellungen pro Kategorie
  einstellungen jsonb NOT NULL DEFAULT '{
    "spielergebnisse": true,
    "transaktionen":   true,
    "app_updates":     true
  }'::jsonb,
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am timestamptz NOT NULL DEFAULT now()
);

-- Index für schnelles Lookup nach Spieler
CREATE INDEX IF NOT EXISTS idx_push_subs_spieler
  ON push_subscriptions(spieler_id);

-- Index für Lookup nach Kategorie (z.B. alle mit app_updates=true)
CREATE INDEX IF NOT EXISTS idx_push_subs_einstellungen
  ON push_subscriptions USING gin(einstellungen);

-- Row Level Security: Spieler kann nur seine eigenen Subscriptions sehen/verwalten
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eigene Subscription lesen"
  ON push_subscriptions FOR SELECT
  USING (
    spieler_id = (
      SELECT id FROM spieler WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Eigene Subscription einfügen"
  ON push_subscriptions FOR INSERT
  WITH CHECK (
    spieler_id = (
      SELECT id FROM spieler WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Eigene Subscription aktualisieren"
  ON push_subscriptions FOR UPDATE
  USING (
    spieler_id = (
      SELECT id FROM spieler WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Eigene Subscription löschen"
  ON push_subscriptions FOR DELETE
  USING (
    spieler_id = (
      SELECT id FROM spieler WHERE auth_user_id = auth.uid()
    )
  );

-- Service Role (Edge Function) darf alle Subscriptions lesen (für Push-Versand)
CREATE POLICY "Service Role liest alle"
  ON push_subscriptions FOR SELECT
  TO service_role
  USING (true);
