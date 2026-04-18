-- Track number of buy-ins per player in an online session
ALTER TABLE online_seats ADD COLUMN IF NOT EXISTS buyins integer NOT NULL DEFAULT 1;
