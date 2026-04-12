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
