// DTKS Poker – Supabase Edge Function: send-push
// Versendet Web Push Notifications an einen oder mehrere Spieler.
//
// Aufruf (POST):
//   URL:  https://<project>.supabase.co/functions/v1/send-push
//   Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   Body: {
//     spieler_ids: string[]   // UUIDs der Empfänger (leer = alle)
//     title:       string
//     body:        string
//     data?:       object     // z.B. { url: '/app#transaktionen', tag: 'transaktion' }
//     kategorie?:  'spielergebnisse' | 'transaktionen' | 'app_updates'
//   }
//
// Umgebungsvariablen (Supabase Secrets):
//   PRIVATE_VAPID_KEY  – Base64url-kodierter privater VAPID-Schlüssel
//   VAPID_SUBJECT      – mailto: oder https: URL (Absender-Identität)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY  = 'BGumKAOH09NkYA-3yZFQZu6lzIYXlvhGvxOlyHmFiVSfCgfDmF787TUNKl5lvV5L1efvA5qujAorCxhQcluY2hE';
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@dtks-poker.app';
const PRIVATE_VAPID_KEY = Deno.env.get('PRIVATE_VAPID_KEY') ?? '';

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function base64urlToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - base64url.length % 4) % 4);
  const base64  = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function importVapidKey(privateKeyBase64url: string): Promise<CryptoKey> {
  const rawPrivate = base64urlToUint8Array(privateKeyBase64url);
  const rawPublic  = base64urlToUint8Array(VAPID_PUBLIC_KEY);
  // Importiere als ECDH/ECDSA P-256 Schlüsselpaar
  return await crypto.subtle.importKey(
    'raw',
    rawPrivate,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  ).catch(async () => {
    // Fallback: JWK-Format
    return await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC', crv: 'P-256',
        d: privateKeyBase64url,
        x: VAPID_PUBLIC_KEY.slice(0, 43),  // approximate – wird unten korrekt geladen
        y: VAPID_PUBLIC_KEY.slice(43),
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
  });
}

async function buildVapidHeader(audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600; // 12h gültig

  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp, sub: VAPID_SUBJECT };

  const encode = (obj: object) =>
    uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(obj)));

  const sigInput = `${encode(header)}.${encode(payload)}`;

  // Privaten Schlüssel aus Base64url-Raw-Format importieren
  // Der Private Key ist ein 32-Byte skalarer Wert – via JWK laden
  const privKeyBytes = base64urlToUint8Array(PRIVATE_VAPID_KEY);
  // Public Key aus VAPID_PUBLIC_KEY: uncompressed point (0x04 + 32 + 32 bytes)
  const pubKeyBytes  = base64urlToUint8Array(VAPID_PUBLIC_KEY);

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      d: uint8ArrayToBase64url(privKeyBytes),
      x: uint8ArrayToBase64url(pubKeyBytes.slice(1, 33)),
      y: uint8ArrayToBase64url(pubKeyBytes.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );

  const jwt = `${sigInput}.${uint8ArrayToBase64url(new Uint8Array(sig))}`;
  return `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`;
}

// ── Payload verschlüsseln (RFC 8291 / aesgcm-128) ───────────────────────────

async function encryptPayload(
  subscription: { endpoint: string; p256dh: string; auth: string },
  plaintext: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const clientPublicKey = base64urlToUint8Array(
    subscription.p256dh.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  );
  const authSecret = base64urlToUint8Array(
    subscription.auth.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  );

  // Ephemeres Server-Schlüsselpaar erzeugen
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)
  );

  // Client Public Key importieren
  const clientKey = await crypto.subtle.importKey(
    'raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, serverKeyPair.privateKey, 256
  );

  // Salt (16 bytes zufällig)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK via HKDF (auth secret)
  const prkKey = await crypto.subtle.importKey('raw', authSecret, 'HKDF', false, ['deriveBits']);
  const prk = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(sharedSecret), info: new TextEncoder().encode('Content-Encoding: auth\0') },
    prkKey, 256
  );

  // Content encryption key + nonce via HKDF
  const prkKey2 = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);

  // keyinfo + nonceinfo nach RFC 8291
  const len = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
  const keyInfo = new Uint8Array([
    ...new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
    0x01
  ]);
  const nonceInfo = new Uint8Array([
    ...new TextEncoder().encode('Content-Encoding: nonce\0'),
    0x01
  ]);

  const contentKey = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: keyInfo }, prkKey2, 128
  );
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prkKey2, 96
    )
  );

  // AES-128-GCM verschlüsseln
  const encKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  const plainbytes = new TextEncoder().encode(plaintext);
  // 2-Byte padding length + 0-Bytes padding + delimiter 0x02
  const padded = new Uint8Array([0, 0, ...plainbytes]);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, padded)
  );

  return { ciphertext, salt, serverPublicKey: serverPublicKeyRaw };
}

// ── Push senden ─────────────────────────────────────────────────────────────

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  ttl = 86400
): Promise<number> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const vapidHeader = await buildVapidHeader(audience);

  const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, payload);

  // RFC 8291 Content-Encoding: aes128gcm record header
  // salt(16) + rs(4) + keyid_len(1) + keyid(65)
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  const header = new Uint8Array([
    ...salt,
    ...rs,
    serverPublicKey.length,
    ...serverPublicKey
  ]);
  const body = new Uint8Array([...header, ...ciphertext]);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': String(ttl),
      'Authorization': vapidHeader,
    },
    body,
  });

  return res.status;
}

// ── Handler ──────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: { spieler_ids?: string[]; title: string; body: string; data?: object; kategorie?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS });
  }

  const { spieler_ids, title, body: msg, data = {}, kategorie } = body;
  if (!title || !msg) {
    return new Response('Missing title or body', { status: 400, headers: CORS });
  }

  // Subscriptions laden
  let query = supabase.from('push_subscriptions').select('*');
  if (spieler_ids && spieler_ids.length > 0) {
    query = query.in('spieler_id', spieler_ids);
  }
  // Kategorie-Filter: nur Subscriptions mit aktivierter Kategorie
  if (kategorie) {
    query = query.eq(`einstellungen->>${kategorie}`, 'true');
  }

  const { data: subs, error } = await query;
  if (error) {
    console.error('DB Fehler:', error);
    return new Response('DB Error', { status: 500, headers: CORS });
  }
  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ sent: 0, errors: 0 }), {
      headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }

  const payload = JSON.stringify({ title, body: msg, data });
  let sent = 0, errors = 0;
  const toDelete: string[] = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      const status = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload
      );
      if (status === 201 || status === 200) {
        sent++;
      } else if (status === 410 || status === 404) {
        // Subscription abgelaufen/ungültig → löschen
        toDelete.push(sub.endpoint);
        errors++;
      } else {
        console.warn(`Push Fehler ${status} für ${sub.spieler_id}`);
        errors++;
      }
    } catch (e) {
      console.error('Push Exception:', e);
      errors++;
    }
  }));

  // Abgelaufene Subscriptions aufräumen
  if (toDelete.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', toDelete);
  }

  console.log(`Push gesendet: ${sent} OK, ${errors} Fehler`);
  return new Response(JSON.stringify({ sent, errors }), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
});
