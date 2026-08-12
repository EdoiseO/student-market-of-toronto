import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

function getSafeRedirectUrl(next, origin) {
  const fallbackUrl = new URL("/", origin);

  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return fallbackUrl;
  }

  try {
    const redirectUrl = new URL(next, origin);
    return redirectUrl.origin === origin ? redirectUrl : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectUrl = getSafeRedirectUrl(searchParams.get("next"), origin);

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(redirectUrl);
}
