-- Paket 1: Sitz-Integrität
-- Bug: Derselbe Account konnte sich parallel von zwei Geräten (PC + Handy) an
-- denselben Tisch setzen → zwei Sitze für einen Spieler in einer Session.
-- Der Client prüfte nur den lokalen State; in der DB fehlte ein Unique-Constraint.

-- Vorsichtshalber evtl. vorhandene Duplikate bereinigen:
-- behalten wird pro (Session, Spieler) der Sitz mit dem höchsten Stack,
-- bei Gleichstand die niedrigste Sitznummer.
delete from online_seat_cards c
using online_seats s, online_seats d
where c.seat_id = s.id
  and s.online_spiel_id = d.online_spiel_id
  and s.spieler_id = d.spieler_id
  and s.id <> d.id
  and (s.stack, -s.seat, s.id::text) < (d.stack, -d.seat, d.id::text);

delete from online_seats s
using online_seats d
where s.online_spiel_id = d.online_spiel_id
  and s.spieler_id = d.spieler_id
  and s.id <> d.id
  and (s.stack, -s.seat, s.id::text) < (d.stack, -d.seat, d.id::text);

create unique index if not exists online_seats_session_spieler_uniq
  on online_seats (online_spiel_id, spieler_id);

comment on index online_seats_session_spieler_uniq is
  'Ein Spieler kann pro Online-Session nur einen Sitz belegen (verhindert Doppel-Sitz bei parallelem Login auf mehreren Geräten)';
