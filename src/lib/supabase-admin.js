import "server-only";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function createAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createSupabaseAdminClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function verifyUserPassword({ userId, email, password }) {
  if (!supabaseUrl || !supabasePublishableKey || !userId || !email || !password) {
    return false;
  }

  const verifier = createSupabaseAdminClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  let createdSession = false;

  try {
    const { data, error } = await verifier.auth.signInWithPassword({ email, password });
    createdSession = Boolean(data?.session);

    return !error && data?.user?.id === userId;
  } finally {
    if (createdSession) {
      // This client is independent from the request-cookie client. Revoke only
      // the short-lived verification session it created.
      await verifier.auth.signOut({ scope: "local" });
    }
  }
}

export async function getLatestAuthUser(admin, userId, logLabel = "admin auth lookup") {
  if (!admin || !userId) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await admin.auth.admin.getUserById(userId);

  if (error || !user) {
    console.error(
      `Could not verify the latest Auth user for ${logLabel}:`,
      error?.message ?? "Missing latest auth user",
    );
    return null;
  }

  return user;
}
