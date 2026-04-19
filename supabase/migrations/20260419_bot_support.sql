-- ============================================================
-- Bot-Support Migration
-- Im Supabase SQL Editor ausführen (einmalig)
-- ============================================================

-- 1. Spieler: Bot-Flag
ALTER TABLE spieler
  ADD COLUMN IF NOT EXISTS ist_bot boolean DEFAULT false;

-- 2. Online-Spiele: Hat-Bots-Flag (verhindert Statistik-Export)
ALTER TABLE online_spiele
  ADD COLUMN IF NOT EXISTS hat_bots boolean DEFAULT false;

-- 3. Online-Seats: Bot-Konfiguration (aggressivitaet, risiko, bluff, karten_zeigen, style)
ALTER TABLE online_seats
  ADD COLUMN IF NOT EXISTS bot_config jsonb;

-- Indizes für schnelle Bot-Suche (optional)
CREATE INDEX IF NOT EXISTS idx_spieler_ist_bot ON spieler(ist_bot) WHERE ist_bot = true;
CREATE INDEX IF NOT EXISTS idx_online_spiele_hat_bots ON online_spiele(hat_bots) WHERE hat_bots = true;
