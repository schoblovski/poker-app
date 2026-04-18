-- Sicherstellt dass online_seat_cards existiert und im Schema-Cache ist
CREATE TABLE IF NOT EXISTS online_seat_cards (
  seat_id  uuid  PRIMARY KEY REFERENCES online_seats(id) ON DELETE CASCADE,
  cards    jsonb NOT NULL DEFAULT '[]'
);

ALTER TABLE online_seat_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "online_seat_cards_select_own" ON online_seat_cards;
CREATE POLICY "online_seat_cards_select_own"
  ON online_seat_cards FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM online_seats os
      JOIN spieler s ON s.id = os.spieler_id
      WHERE os.id = seat_id AND s.auth_user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
