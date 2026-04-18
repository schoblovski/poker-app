-- Add street_last_actor_id to track who closes each betting round
ALTER TABLE online_spiele
  ADD COLUMN IF NOT EXISTS street_last_actor_id uuid REFERENCES spieler(id);
