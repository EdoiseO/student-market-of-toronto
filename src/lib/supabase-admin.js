import "server-only";

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
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
      `Falling back to session role check for ${logLabel}:`,
      error?.message ?? "Missing latest auth user",
    );
    return null;
  }

  return user;
}
