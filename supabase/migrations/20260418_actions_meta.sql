-- Add meta jsonb to online_actions for storing hand info (hand name, hole cards) at showdown
ALTER TABLE online_actions ADD COLUMN IF NOT EXISTS meta jsonb;
