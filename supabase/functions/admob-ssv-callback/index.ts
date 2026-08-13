// ===== admob-ssv-callback =====
// Public HTTP endpoint registered in the AdMob console as the
// "Server-side verification" callback URL for every rewarded ad
// unit. Google GETs this URL after a user finishes watching a
// rewarded ad, with the reward params signed using ECDSA (P-256 /
// SHA-256). We verify that signature against Google's own rotating
// public keys before crediting anything -- a client alone claiming
// "I watched an ad" is never trusted.
//
// Docs: https://developers.google.com/admob/android/rewarded-video-ssv
//
// AdMob callback query params (the ones we care about):
//   ad_network, ad_unit, reward_amount, reward_item, timestamp,
//   transaction_id, user_id (this is OUR custom_data field --
//   we pass our internal auth user id when loading the ad),
//   signature, key_id
//
// AdMob custom_data also needs to carry which in-app placement
// this ad was shown for (superlike_bonus / coin_topup / etc) and
// an optional group_id -- pass those as extra custom_data fields
// when requesting the ad client-side, e.g.:
//   customData = `${userId}:${placement}:${groupId ?? ''}`

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const GOOGLE_VERIFIER_KEYS_URL =
  "https://www.gstatic.com/admob/reward/verifier-keys.json";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  return _admin;
}

// Cache Google's public keys in memory for the life of the function
// instance -- they rotate infrequently. Re-fetched if a key_id
// we don't recognize shows up (handles rotation without a redeploy).
let _keysCache: { keys: Array<{ keyId: number; pem: string }>; fetchedAt: number } | null = null;

async function getGoogleKeys(forceRefresh = false) {
  if (!forceRefresh && _keysCache && Date.now() - _keysCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return _keysCache.keys;
  }
  const res = await fetch(GOOGLE_VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`Failed to fetch AdMob verifier keys: ${res.status}`);
  const json = await res.json();
  _keysCache = { keys: json.keys, fetchedAt: Date.now() };
  return _keysCache.keys;
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function verifySignature(
  signedData: string,
  signatureB64Url: string,
  keyId: number
): Promise<boolean> {
  const keys = await getGoogleKeys();
  let key = keys.find((k) => k.keyId === keyId);
  if (!key) {
    // Key rotated since our cache -- refresh once and retry.
    const fresh = await getGoogleKeys(true);
    key = fresh.find((k) => k.keyId === keyId);
    if (!key) return false;
  }

  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToDer(key.pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );

  // Signature comes base64url-encoded, DER-encoded ECDSA sig.
  // Web Crypto expects raw (r||s) format, so convert DER -> raw.
  const sigDer = base64UrlToBytes(signatureB64Url);
  const sigRaw = derToRawEcdsaSig(sigDer);

  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    sigRaw,
    new TextEncoder().encode(signedData)
  );
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    b64url.length + ((4 - (b64url.length % 4)) % 4),
    "="
  );
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Minimal DER -> raw (r||s, 32 bytes each) parser for P-256 ECDSA sigs.
function derToRawEcdsaSig(der: Uint8Array): Uint8Array {
  let offset = 2; // skip SEQUENCE tag + length
  function readInt(): Uint8Array {
    offset++; // INTEGER tag
    let len = der[offset++];
    let bytes = der.slice(offset, offset + len);
    offset += len;
    // strip leading zero padding, left-pad to 32 bytes
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length < 32) {
      const padded = new Uint8Array(32);
      padded.set(bytes, 32 - bytes.length);
      bytes = padded;
    }
    return bytes;
  }
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

const ALLOWED_PLACEMENTS = new Set([
  "superlike_bonus",
  "coin_topup",
  "emergency_pause",
  "materials_unlock",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const params = url.searchParams;

  const signature = params.get("signature");
  const keyIdRaw = params.get("key_id");
  const transactionId = params.get("transaction_id");
  const customData = params.get("custom_data") ?? params.get("user_id");
  const rewardAmount = params.get("reward_amount");
  const rewardItem = params.get("reward_item");
  const adUnit = params.get("ad_unit");
  const adNetwork = params.get("ad_network") ?? "admob";
  const timestamp = params.get("timestamp");

  if (!signature || !keyIdRaw || !transactionId || !customData) {
    return new Response("missing required params", { status: 400, headers: CORS_HEADERS });
  }

  // Signed payload is the full query string minus signature + key_id,
  // in the order Google sent them.
  const signedParams = new URLSearchParams(params);
  signedParams.delete("signature");
  signedParams.delete("key_id");
  const signedData = signedParams.toString();

  let sigOk = false;
  try {
    sigOk = await verifySignature(signedData, signature, parseInt(keyIdRaw, 10));
  } catch (e) {
    console.error("SSV signature verification error", e);
  }
  if (!sigOk) {
    return new Response("invalid signature", { status: 403, headers: CORS_HEADERS });
  }

  // Reject stale callbacks (defense-in-depth alongside the
  // transaction_id idempotency check).
  if (timestamp) {
    const ageMs = Date.now() - parseInt(timestamp, 10);
    if (ageMs > 10 * 60 * 1000 || ageMs < -60 * 1000) {
      return new Response("stale callback", { status: 403, headers: CORS_HEADERS });
    }
  }

  // custom_data format: "<userId>:<placement>:<groupId?>"
  const [userId, placement, groupId] = customData.split(":");
  if (!userId || !placement || !ALLOWED_PLACEMENTS.has(placement)) {
    return new Response("bad custom_data", { status: 400, headers: CORS_HEADERS });
  }

  const db = admin();
  const { data, error } = await db.rpc("credit_verified_ad_reward", {
    p_user_id: userId,
    p_transaction_id: transactionId,
    p_placement: placement,
    p_reward_item: rewardItem,
    p_reward_amount: rewardAmount ? parseFloat(rewardAmount) : 0,
    p_ad_unit_id: adUnit,
    p_ad_network: adNetwork,
    p_group_id: groupId || null,
  });

  if (error) {
    console.error("credit_verified_ad_reward failed", error);
    return new Response("credit failed", { status: 500, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
