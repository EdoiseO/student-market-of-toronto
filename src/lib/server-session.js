import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";

// Share verified Auth results only within one Server Component render. The
// proxy independently refreshes cookies; subsequent requests verify again.
export const getServerSession = cache(async () => {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user }, error } = await supabase.auth.getUser();

  return { cookieStore, supabase, user: error ? null : user };
});
