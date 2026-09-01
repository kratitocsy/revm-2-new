import { createClient } from '@supabase/supabase-js';
import { REVM2_CONFIG } from '../../../lib/supabase.js';

// One client instance for this app. The rest of the site creates a
// fresh `sb` per page via `window.supabase.createClient(...)` (CDN
// script) — see src/lib/supabase.js's note on that. This app bundles
// @supabase/supabase-js from npm instead (no CDN global to depend on)
// but points at the same project/anon key, so auth state (session,
// cookies) is shared with the rest of the site.
export const sb = createClient(REVM2_CONFIG.SUPABASE_URL, REVM2_CONFIG.SUPABASE_ANON);
