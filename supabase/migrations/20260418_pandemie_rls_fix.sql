-- RLS Fixes für Pandemie-Modus
-- Im Supabase SQL Editor ausführen

-- 1. online_spiele: Admin darf Status updaten (session beenden, etc.)
CREATE POLICY "online_spiele_update_admin"
  ON online_spiele FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND ist_admin = true
    )
  );

-- 2. online_spiele: Alle eingeloggten Spieler dürfen Session erstellen (nicht nur Admin)
DROP POLICY IF EXISTS "online_spiele_insert" ON online_spiele;
CREATE POLICY "online_spiele_insert"
  ON online_spiele FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND aktiv = true
    )
  );

NOTIFY pgrst, 'reload schema';
