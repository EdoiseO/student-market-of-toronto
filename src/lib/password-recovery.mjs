import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const RECOVERY_STORAGE_KEY = "smt-isolated-recovery";
export const RECOVERY_TTL_SECONDS = 15 * 60;
export const RECOVERY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

export function normalizeRecoveryEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function hasRecoveryOrigin(request) {
  return request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

export function isRecoveryBrowserSecret(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function createRecoveryBrowserSecret() {
  return randomBytes(32).toString("base64url");
}

export function hashRecoveryBrowserSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isRecoveryState(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isRecoveryVerifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}\/recovery$/.test(value);
}

export function validateRecoverySubmission(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "invalid_link";
  // Legacy credential forms are deliberately not compatibility paths.
  if (["access_token", "refresh_token", "token_hash", "type", "session"].some((key) => key in payload)) return "invalid_link";
  if (!isRecoveryState(payload.state) || typeof payload.code !== "string" ||
      !/^[A-Za-z0-9_-]{8,2048}$/.test(payload.code) || !normalizeRecoveryEmail(payload.email)) return "invalid_link";
  if (typeof payload.password !== "string" || payload.password.length < 8 || payload.password.length > 1024) return "password_policy";
  if (payload.password !== payload.confirmPassword) return "password_mismatch";
  return null;
}

// Each client owns an ephemeral Map. It never receives the request cookie jar,
// browser storage, a service-role key, or another user's ordinary session.
export function createIsolatedRecoveryClient({ url, key, verifier, fetch: fetchImpl }) {
  const values = new Map();
  if (verifier) values.set(`${RECOVERY_STORAGE_KEY}-code-verifier`, JSON.stringify(verifier));
  const client = createClient(url, key, {
    auth: {
      flowType: "pkce",
      storageKey: RECOVERY_STORAGE_KEY,
      storage: {
        getItem: (name) => values.get(name) ?? null,
        setItem: (name, value) => { values.set(name, value); },
        removeItem: (name) => { values.delete(name); },
      },
      // Custom storage is honored only with persistSession:true. Persistence
      // here is strictly this request's Map, never cookies or localStorage.
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      experimental: { appendPkceFlowIdToRedirects: false },
    },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
  return {
    client,
    readVerifier() {
      const value = values.get(`${RECOVERY_STORAGE_KEY}-code-verifier`);
      return value ? JSON.parse(value) : null;
    },
    clear() { values.clear(); },
  };
}

// claim() must atomically consume a server-created, unexpired intent matching
// all three values. The verifier is stored only by resetPasswordForEmail.
export async function completePasswordRecovery({ payload, browserHash, claim, createIsolatedClient }) {
  const invalid = validateRecoverySubmission(payload);
  if (invalid) return { status: 400, error: invalid };
  const email = normalizeRecoveryEmail(payload.email);
  const intent = await claim({ state: payload.state, browserHash, email });
  if (!intent || intent.email !== email || !isRecoveryVerifier(intent.verifier)) {
    return { status: 400, error: "invalid_link" };
  }

  const isolated = createIsolatedClient(intent.verifier);
  let hasSession = false;
  let changed = false;
  let userId = null;
  let result;
  try {
    const exchange = await isolated.client.auth.exchangeCodeForSession(payload.code);
    hasSession = Boolean(exchange.data?.session);
    if (exchange.error || !hasSession || exchange.data?.redirectType !== "recovery") {
      result = { status: 400, error: "invalid_link" };
    } else {
      // Ask Auth to verify identity; neither URL values nor a cached session
      // authorizes the target account.
      const verified = await isolated.client.auth.getUser();
      if (verified.error || !verified.data?.user?.id ||
          normalizeRecoveryEmail(verified.data.user.email) !== email ||
          verified.data.user.id !== exchange.data.user?.id) {
        result = { status: 400, error: "invalid_link" };
      } else {
        userId = verified.data.user.id;
        const update = await isolated.client.auth.updateUser({ password: payload.password });
        if (update.error) {
          const ambiguous = update.error.status === 0 || update.error.status >= 500 || update.error.name === "AuthRetryableFetchError";
          result = { status: ambiguous ? 503 : 400, error: ambiguous ? "outcome_unknown" : "password_rejected" };
        } else if (update.data?.user?.id !== userId) {
          result = { status: 503, error: "outcome_unknown" };
        } else {
          changed = true;
          result = { status: 200, updated: true, userId };
        }
      }
    }
  } catch {
    // A disconnected response cannot establish whether Auth changed the
    // password. Do not replay a consumed intent or report definite failure.
    result = { status: 503, error: userId ? "outcome_unknown" : "invalid_link" };
  } finally {
    if (hasSession) {
      try {
        const revoked = await isolated.client.auth.signOut({ scope: changed ? "global" : "local" });
        if (changed && revoked.error) result = { ...result, sessionsRevoked: false };
        else if (changed) result = { ...result, sessionsRevoked: true };
      } catch {
        if (changed) result = { ...result, sessionsRevoked: false };
      }
    }
    isolated.clear();
  }
  return result;
}
