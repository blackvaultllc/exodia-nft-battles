// XOVIA — server-side Supabase client with the service-role key. Bypasses RLS.
// SECURITY: import this ONLY from server functions / server routes. Never from
// anything reachable by the browser bundle.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Set them in .env per the documented schema.`;
    console.error(`[XOVIA/Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
let _supabaseAdmin: SupabaseAdminClient | undefined;

// Import like: import { supabaseAdmin } from "@/integrations/supabase/client.server";
export const supabaseAdmin = new Proxy({} as SupabaseAdminClient, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
