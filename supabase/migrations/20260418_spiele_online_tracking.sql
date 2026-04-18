-- Track whether a spiel was played online and which variant was used
-- modus: 'cash' (default, physical) | 'online'
-- online_variante: 'holdem' | 'omaha' | 'texahma' (only set for online games)
ALTER TABLE spiele ADD COLUMN IF NOT EXISTS modus text DEFAULT 'cash';
ALTER TABLE spiele ADD COLUMN IF NOT EXISTS online_variante text;
