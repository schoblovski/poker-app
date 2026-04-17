-- ============================================================
-- Pandemie-Modus Migration
-- Online-Poker via Supabase Realtime
-- Im Supabase SQL Editor ausführen
-- ============================================================


-- 1. spiele.modus Spalte (cash / turnier / online)
-- ============================================================

ALTER TABLE spiele
  ADD COLUMN IF NOT EXISTS modus text NOT NULL DEFAULT 'cash'
  CHECK (modus IN ('cash', 'turnier', 'online'));


-- 2. online_spiele – Session-Zustand
-- ============================================================

CREATE TABLE IF NOT EXISTS online_spiele (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  spiel_id          uuid        REFERENCES spiele(id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'waiting'
                                CHECK (status IN ('waiting', 'running', 'finished')),
  variante          text        NOT NULL DEFAULT 'holdem'
                                CHECK (variante IN ('holdem', 'omaha', 'texahma')),
  dealer_seat       int         CHECK (dealer_seat BETWEEN 1 AND 9),
  current_player_id uuid        REFERENCES spieler(id),
  pot               numeric     NOT NULL DEFAULT 0,
  community_cards   jsonb       NOT NULL DEFAULT '[]',
  runout_cards      jsonb,
  hand_nr           int         NOT NULL DEFAULT 0,
  street            text        CHECK (street IN ('preflop', 'flop', 'turn', 'river')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE online_spiele IS 'Pandemie-Modus: Spielzustand (sichtbar für alle Teilnehmer)';
COMMENT ON COLUMN online_spiele.runout_cards IS 'Was wäre noch gekommen – aufgedeckt nach Hand-Ende durch Fold';


-- 3. online_decks – Gemischtes Deck (NUR für Edge Functions via Service Role)
-- ============================================================

CREATE TABLE IF NOT EXISTS online_decks (
  id   uuid  PRIMARY KEY REFERENCES online_spiele(id) ON DELETE CASCADE,
  deck jsonb NOT NULL
);

COMMENT ON TABLE online_decks IS 'Kein Client-Zugriff! Nur Edge Functions via Service Role lesen/schreiben hier.';


-- 4. online_seats – Spieler am Tisch
-- ============================================================

CREATE TABLE IF NOT EXISTS online_seats (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  online_spiel_id   uuid        NOT NULL REFERENCES online_spiele(id) ON DELETE CASCADE,
  spieler_id        uuid        NOT NULL REFERENCES spieler(id),
  seat              int         NOT NULL CHECK (seat BETWEEN 1 AND 9),
  stack             numeric     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'folded', 'allin', 'paused', 'sitting_out')),
  bet_current_round numeric     NOT NULL DEFAULT 0,
  auto_folded       boolean     NOT NULL DEFAULT false,

  -- Pause-Einstellungen (während aktiver Hand)
  pause_auto_action text        DEFAULT 'fold'
                                CHECK (pause_auto_action IN ('fold', 'check', 'call_limit', 'call_any')),
  pause_call_limit  numeric,

  -- Pre-Action (bevor man dran ist)
  pre_action        text        CHECK (pre_action IN ('fold', 'check_fold', 'check', 'call', 'call_any')),
  pre_action_limit  numeric,

  paused_at         timestamptz,

  UNIQUE (online_spiel_id, spieler_id),
  UNIQUE (online_spiel_id, seat)
);

COMMENT ON COLUMN online_seats.pause_call_limit IS '€-Limit für call_limit Auto-Aktion bei Pause';
COMMENT ON COLUMN online_seats.pre_action_limit IS 'Optionales €-Limit für pre_action call (darüber → fold)';
COMMENT ON COLUMN online_seats.paused_at IS 'Timestamp für Was-habe-ich-verpasst Berechnung';


-- 5. online_seat_cards – Hole Cards (nur lesbar durch Kartenbesitzer)
-- ============================================================

CREATE TABLE IF NOT EXISTS online_seat_cards (
  seat_id    uuid  PRIMARY KEY REFERENCES online_seats(id) ON DELETE CASCADE,
  hole_cards jsonb NOT NULL DEFAULT '[]'
);

COMMENT ON TABLE online_seat_cards IS 'RLS: nur lesbar durch den Kartenbesitzer (auth.uid = spieler.auth_user_id)';


-- 6. online_actions – Action-Log pro Hand
-- ============================================================

CREATE TABLE IF NOT EXISTS online_actions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  online_spiel_id uuid        NOT NULL REFERENCES online_spiele(id) ON DELETE CASCADE,
  spieler_id      uuid        REFERENCES spieler(id),
  action          text        NOT NULL,
  amount          numeric,
  street          text,
  hand_nr         int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN online_actions.spieler_id IS 'NULL = System-Aktion (z.B. Karten aufdecken)';
COMMENT ON COLUMN online_actions.action IS 'fold | call | raise | check | allin | pause | resume | reveal_runout | new_hand';


-- 7. online_chat – Tisch-Chat
-- ============================================================

CREATE TABLE IF NOT EXISTS online_chat (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  online_spiel_id uuid        NOT NULL REFERENCES online_spiele(id) ON DELETE CASCADE,
  spieler_id      uuid        NOT NULL REFERENCES spieler(id),
  message         text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- RLS aktivieren
-- ============================================================

ALTER TABLE online_spiele     ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_decks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_seats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_seat_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_actions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_chat       ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- RLS Policies – online_spiele
-- ============================================================

CREATE POLICY "online_spiele_select"
  ON online_spiele FOR SELECT TO authenticated
  USING (true);

-- Nur Admins dürfen neue Online-Sessions erstellen
CREATE POLICY "online_spiele_insert"
  ON online_spiele FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND ist_admin = true
    )
  );

-- UPDATE/DELETE nur via Service Role (Edge Functions) – kein Client-Zugriff


-- ============================================================
-- RLS Policies – online_decks
-- ============================================================

-- Keine Policies → kein Zugriff für anon/authenticated
-- Edge Functions nutzen Service Role Key → umgehen RLS


-- ============================================================
-- RLS Policies – online_seats
-- ============================================================

CREATE POLICY "online_seats_select"
  ON online_seats FOR SELECT TO authenticated
  USING (true);

-- Spieler kann sich selbst an den Tisch setzen
CREATE POLICY "online_seats_insert"
  ON online_seats FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND id = spieler_id
    )
  );

-- Spieler kann nur eigene Pause/Pre-Action Einstellungen updaten
CREATE POLICY "online_seats_update_own"
  ON online_seats FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND id = spieler_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND id = spieler_id
    )
  );


-- ============================================================
-- RLS Policies – online_seat_cards
-- ============================================================

-- Nur eigene Hole Cards lesbar
CREATE POLICY "online_seat_cards_select_own"
  ON online_seat_cards FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM online_seats os
      JOIN spieler s ON s.id = os.spieler_id
      WHERE os.id = seat_id
        AND s.auth_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE nur via Service Role (Edge Functions)


-- ============================================================
-- RLS Policies – online_actions
-- ============================================================

CREATE POLICY "online_actions_select"
  ON online_actions FOR SELECT TO authenticated
  USING (true);

-- Spieler kann eigene Actions einfügen (Game-Logik validiert Edge Function)
CREATE POLICY "online_actions_insert"
  ON online_actions FOR INSERT TO authenticated
  WITH CHECK (
    spieler_id IS NULL OR
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND id = spieler_id
    )
  );


-- ============================================================
-- RLS Policies – online_chat
-- ============================================================

CREATE POLICY "online_chat_select"
  ON online_chat FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "online_chat_insert"
  ON online_chat FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spieler
      WHERE auth_user_id = auth.uid() AND id = spieler_id
    )
  );


-- ============================================================
-- Realtime aktivieren (nur sichtbare Tabellen!)
-- online_decks + online_seat_cards NICHT in Realtime
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE online_spiele;
ALTER PUBLICATION supabase_realtime ADD TABLE online_seats;
ALTER PUBLICATION supabase_realtime ADD TABLE online_actions;
ALTER PUBLICATION supabase_realtime ADD TABLE online_chat;


-- ============================================================
-- Performance-Indizes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_online_spiele_spiel_id     ON online_spiele(spiel_id);
CREATE INDEX IF NOT EXISTS idx_online_spiele_status        ON online_spiele(status);
CREATE INDEX IF NOT EXISTS idx_online_seats_spiel_id       ON online_seats(online_spiel_id);
CREATE INDEX IF NOT EXISTS idx_online_seats_spieler_id     ON online_seats(spieler_id);
CREATE INDEX IF NOT EXISTS idx_online_actions_spiel_id     ON online_actions(online_spiel_id);
CREATE INDEX IF NOT EXISTS idx_online_actions_hand_nr      ON online_actions(online_spiel_id, hand_nr);
CREATE INDEX IF NOT EXISTS idx_online_actions_created      ON online_actions(online_spiel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_online_chat_spiel_id        ON online_chat(online_spiel_id);
CREATE INDEX IF NOT EXISTS idx_online_chat_created         ON online_chat(online_spiel_id, created_at);
