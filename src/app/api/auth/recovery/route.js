import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";
import {
  completePasswordRecovery, createIsolatedRecoveryClient, createRecoveryBrowserSecret,
  hashRecoveryBrowserSecret, hasRecoveryOrigin, isRecoveryBrowserSecret,
  isRecoveryState, isRecoveryVerifier, normalizeRecoveryEmail, RECOVERY_HEADERS,
  RECOVERY_TTL_SECONDS, validateRecoverySubmission,
} from "@/lib/password-recovery.mjs";

export const runtime = "nodejs";

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: RECOVERY_HEADERS });
}

function cookieName(request) {
  return new URL(request.url).protocol === "https:" ? "__Host-smt-recovery" : "smt-recovery";
}

function isolated(verifier) {
  return createIsolatedRecoveryClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    verifier,
  });
}

// Read-only landing context: no code exchange, cookie writes or session adoption.
export async function GET(request) {
  const state = new URL(request.url).searchParams.get("state");
  const secret = request.cookies.get(cookieName(request))?.value;
  if (!isRecoveryState(state) || !isRecoveryBrowserSecret(secret)) return json({ error: "invalid_link" }, 400);
  const admin = createAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  const { data, error } = await admin.from("password_recovery_intents")
    .select("email").eq("id", state).eq("browser_hash", hashRecoveryBrowserSecret(secret))
    .eq("purpose", "password_recovery").is("consumed_at", null).not("verifier", "is", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) return json({ error: "unavailable" }, 503);
  return data ? json({ email: data.email }) : json({ error: "invalid_link" }, 400);
}

export async function POST(request) {
  if (!hasRecoveryOrigin(request)) return json({ error: "invalid_request" }, 403);
  let payload;
  try {
    const body = await request.text();
    if (body.length > 8192) return json({ error: "invalid_request" }, 400);
    payload = JSON.parse(body);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const admin = createAdminClient();
  if (!admin || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) return json({ error: "unavailable" }, 503);
  const existingSecret = request.cookies.get(cookieName(request))?.value;

  if (payload?.action === "request") {
    const email = normalizeRecoveryEmail(payload.email);
    if (!email) return json({ error: "invalid_email" }, 400);
    const secret = isRecoveryBrowserSecret(existingSecret) ? existingSecret : createRecoveryBrowserSecret();
    const browserHash = hashRecoveryBrowserSecret(secret);
    const state = randomUUID();
    try {
      const reserved = await admin.rpc("reserve_password_recovery_intent", {
        p_id: state, p_browser_hash: browserHash, p_email: email,
      });
      if (reserved.error) return json({ error: "unavailable" }, 503);
      if (reserved.data) {
        const recovery = isolated();
        try {
          const redirect = new URL("/reset-password", new URL(request.url).origin);
          redirect.searchParams.set("state", state);
          const sent = await recovery.client.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
          const verifier = recovery.readVerifier();
          if (!sent.error && isRecoveryVerifier(verifier)) {
            const saved = await admin.from("password_recovery_intents").update({ verifier })
              .eq("id", state).eq("browser_hash", browserHash).is("consumed_at", null);
            if (saved.error) return json({ error: "unavailable" }, 503);
          } else if (sent.error && sent.error.status >= 500) {
            return json({ error: "unavailable" }, 503);
          }
          // Account absence and provider/application rate limits share the
          // same response; no mailbox existence signal is exposed.
        } finally {
          recovery.clear();
        }
      }
      const response = json({ sent: true });
      response.cookies.set(cookieName(request), secret, {
        httpOnly: true, secure: new URL(request.url).protocol === "https:",
        sameSite: "lax", path: "/", maxAge: RECOVERY_TTL_SECONDS,
      });
      return response;
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }

  if (payload?.action !== "complete" || !isRecoveryBrowserSecret(existingSecret)) return json({ error: "invalid_link" }, 400);
  const invalid = validateRecoverySubmission(payload);
  if (invalid) return json({ error: invalid }, 400);

  try {
    // Read the ordinary identity before revoking recovery sessions. This
    // client is never passed a recovery token and never switches accounts.
    const cookieStore = await cookies();
    const ordinary = createClient(cookieStore);
    const current = await ordinary.auth.getUser();
    const result = await completePasswordRecovery({
      payload,
      browserHash: hashRecoveryBrowserSecret(existingSecret),
      createIsolatedClient: isolated,
      claim: async ({ state, browserHash, email }) => {
        const claimed = await admin.rpc("claim_password_recovery_intent", {
          p_id: state, p_browser_hash: browserHash, p_email: email,
        });
        if (claimed.error) throw new Error("Recovery intent unavailable");
        return claimed.data?.[0] ?? null;
      },
    });
    let preservedSession = Boolean(current.data?.user);
    if (result.updated && current.data?.user?.id === result.userId) {
      // Only the recovered account's ordinary browser session is cleared.
      // A different account's cookies are left intact.
      try {
        const signedOut = await ordinary.auth.signOut({ scope: "local" });
        preservedSession = false;
        if (signedOut.error) result.sessionsRevoked = false;
      } catch {
        result.sessionsRevoked = false;
      }
    }
    return json(result.updated
      ? { updated: true, sessionsRevoked: result.sessionsRevoked, preservedSession }
      : { error: result.error }, result.status);
  } catch {
    return json({ error: "outcome_unknown" }, 503);
  }
}
