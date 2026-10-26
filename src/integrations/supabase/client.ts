// XOVIA — public (anon/RLS-respecting) Supabase client.
// Reads the environmental schema from `.env` via Vite (client) or process.env (SSR).
// No platform wrappers, no fallbacks to host-specific providers.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function resolveClientEnv() {
  // Client bundle: Vite inlines only VITE_* keys. SSR: read process.env directly.
  const url =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
    (typeof process !== "undefined" ? process.env?.VITE_SUPABASE_URL : undefined) ||
    (typeof process !== "undefined" ? process.env?.SUPABASE_URL : undefined);

  const anonKey =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    (typeof process !== "undefined" ? process.env?.VITE_SUPABASE_ANON_KEY : undefined) ||
    (typeof process !== "undefined" ? process.env?.VITE_SUPABASE_PUBLISHABLE_KEY : undefined) ||
    (typeof process !== "undefined" ? process.env?.SUPABASE_ANON_KEY : undefined) ||
    (typeof process !== "undefined" ? process.env?.SUPABASE_PUBLISHABLE_KEY : undefined);

  return { url, anonKey };
}

function createSupabaseClient() {
  const { url, anonKey } = resolveClientEnv();

  if (!url || !anonKey) {
    const missing = [
      ...(!url ? ["VITE_SUPABASE_URL"] : []),
      ...(!anonKey ? ["VITE_SUPABASE_ANON_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Set them in .env per the documented schema.`;
    console.error(`[XOVIA/Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: { "x-client-info": "xovia-battle-generations" },
    },
    db: { schema: "public" },
  });
}

type SupabaseClient = ReturnType<typeof createSupabaseClient>;
let _supabase: SupabaseClient | undefined;

// Lazily-instantiated singleton proxy: nothing is created (and no env var is
// demanded) until the first actual database/auth call. This keeps fast mounts
// fast during SSR and avoids build-time crashes when env is not yet wired.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
