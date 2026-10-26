// XOVIA — Google Cloud Console OAuth2 sign-in via Supabase Auth.
// Replaces the former host-platform auth wrapper: this module talks straight to
// the Supabase Auth API using the credentials configured in .env.
//   GOOGLE_OAUTH2_CLIENT_ID / GOOGLE_OAUTH2_CLIENT_SECRET  → set in the Supabase
//     dashboard (Auth → Providers → Google) and mirrored here for server config.
//   VITE_GOOGLE_OAUTH2_CLIENT_ID → public client id, safe for the browser.
import { supabase } from "../supabase/client";

export function googleOAuthConfigured(): boolean {
  // Google is enabled as an Auth provider in the Supabase dashboard, so no
  // client-side credentials are required — Supabase hosts the OAuth flow.
  return true;
}

export type OAuthResult = { error: Error | null };

export async function signInWithGoogle(redirectTo?: string): Promise<OAuthResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo:
        redirectTo ?? (typeof window !== "undefined" ? window.location.origin : undefined),
    },
  });
  return { error: error ? new Error(error.message) : null };
}
