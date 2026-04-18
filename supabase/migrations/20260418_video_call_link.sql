-- Rename WhatsApp-specific key to generic video_call_link
UPDATE einstellungen SET key='video_call_link' WHERE key='whatsapp_gruppe';
