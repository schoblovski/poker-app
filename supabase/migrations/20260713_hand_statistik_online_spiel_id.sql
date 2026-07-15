-- Paket 3 / K6: Hand ↔ Online-Spiel verknüpfen
-- Hände, die über «Hand festhalten» am Online-Tisch erfasst werden, referenzieren
-- die Online-Session. Bei der Payout-Bestätigung (spiele-Eintrag entsteht) wird
-- spiel_id nachgetragen → Hände erscheinen im Spiel-Detail.
-- ON DELETE SET NULL: beim Löschen einer Session (poker-delete-session) bleiben
-- die besonderen Hände erhalten.

alter table hand_statistik
  add column if not exists online_spiel_id uuid references online_spiele(id) on delete set null;

comment on column hand_statistik.online_spiel_id is
  'Online-Modus: Session, an deren Tisch die Hand festgehalten wurde (nullable; spiel_id wird bei Payout-Bestätigung nachgetragen)';

create index if not exists idx_hand_statistik_online_spiel_id
  on hand_statistik(online_spiel_id) where online_spiel_id is not null;
