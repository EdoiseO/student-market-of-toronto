import { createClient } from "@/utils/supabase/middleware";
import { NextResponse } from "next/server";

export async function proxy(request) {
  const supabaseResponse = createClient(request);

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
