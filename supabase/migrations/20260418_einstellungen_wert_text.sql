-- Change einstellungen.wert from numeric to text so it can store URLs and flag values
ALTER TABLE einstellungen ALTER COLUMN wert TYPE text USING wert::text;
