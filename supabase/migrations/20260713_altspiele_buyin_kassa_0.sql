-- Alt-Spiele (buyin_pot < 5, z.B. Pokernacht 2.5): Der Pokerkasse-Anteil war bei
-- diesen Abenden nie Teil der Buy-In-Kosten. Bisher wurde das per Code-Heuristik
-- (bPot < 5 → Kassa 0) behandelt; ab jetzt steht es explizit in den Daten,
-- die Heuristik entfällt im Code (kostenProBuyin = buyin_pot + buyin_kassa).
UPDATE spiele SET buyin_kassa = 0 WHERE buyin_pot < 5;
