// Supabase client — shared with the legacy Agromat_Parcer Flask app.
// Tables we touch: products, competitors, price_snapshots, url_overrides.
// Service-role key is required for writes (audit/snapshots). Never import
// from a "use client" file — the key must stay server-side.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var _supabase: SupabaseClient | undefined;
}

export function getSupabase(): SupabaseClient {
  if (!global._supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in env");
    }
    global._supabase = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return global._supabase;
}
