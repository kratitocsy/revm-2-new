/* ============================================================
   RevM² — src/lib/supabase.js

   Supabase connection config for the app (URL, anon key, plus the
   Google Drive / Telegram integration keys that ride alongside it).
   NOTE: this holds *config*, not a client factory — each page still
   does its own `const sb = window.supabase.createClient(REVM2_CONFIG.SUPABASE_URL, REVM2_CONFIG.SUPABASE_ANON)`
   rather than importing a shared client instance from here. Centralizing
   that too is a reasonable next step, but changes runtime behavior
   (one shared client vs. one per page) so it's deliberately not done
   in this reorg pass — see docs/MODULARIZATION.md.
   ============================================================ */

/* ── SUPABASE CONFIG ─────────────────────────────────────── */
export const REVM2_CONFIG = {
  SUPABASE_URL:  'https://dhzjtjekbvxxsauzhadl.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoemp0amVrYnZ4eHNhdXpoYWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNjQ2NjUsImV4cCI6MjA5Nzk0MDY2NX0.2Uo36DtE7NpwW5wxOEwnmWjbXhHWXV-wf6qc7kXDtYE',
  /* ── Google Drive picker (materials import) ──────────────────────
   * Needed only for the "Import from Drive" button on the Materials
   * panel. Get these from a Google Cloud Console project:
   *   1. APIs & Services → Library → enable "Google Picker API" and
   *      "Google Drive API".
   *   2. Credentials → Create API key → GOOGLE_API_KEY below.
   *   3. Credentials → Create OAuth client ID (type: Web application),
   *      add your app's origin(s) under "Authorized JavaScript origins"
   *      → GOOGLE_CLIENT_ID below.
   * Leave both empty to hide the Drive-import button entirely. */
  GOOGLE_API_KEY:   '',
  GOOGLE_CLIENT_ID: '',
  /* ── Telegram Login (sign-in via @revm2_bot) ──────────────────────
   * The numeric bot ID - the digits before the ':' in your bot token
   * from @BotFather (e.g. token "1234567890:AAF..." → bot ID
   * "1234567890"). NOT the bot's username or its token itself - this
   * ID is public-safe, unlike the token.
   * Also required, done once in Telegram itself, not here:
   *   message @BotFather → /setdomain → @revm2_bot → your production
   *   domain (e.g. revm-2-new.vercel.app) - the widget only works on
   *   a domain the bot has explicitly allowed.
   * Leave empty to hide the "Continue with Telegram" button. */
  TELEGRAM_BOT_ID: '',
};

