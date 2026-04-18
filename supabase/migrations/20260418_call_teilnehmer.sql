-- Track who is currently in the video call (self-reported via button click)
ALTER TABLE online_spiele ADD COLUMN IF NOT EXISTS call_teilnehmer jsonb DEFAULT '[]';
