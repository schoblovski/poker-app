-- Alle authentifizierten aktiven Spieler dürfen online_spiele updaten
-- (z.B. Session beenden, nicht nur Admin)
DROP POLICY IF EXISTS "online_spiele_update_admin" ON online_spiele;
CREATE POLICY "online_spiele_update_all"
  ON online_spiele FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM spieler WHERE auth_user_id = auth.uid() AND aktiv = true
  ));

NOTIFY pgrst, 'reload schema';
