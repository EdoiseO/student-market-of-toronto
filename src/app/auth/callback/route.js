import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

const callbackHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

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
  const failed = () => NextResponse.redirect(new URL("/login?auth_error=invalid_link", origin), { headers: callbackHeaders });

  // Recovery has a separate POST-only, browser-bound flow. Old callbacks may
  // not exchange a code into the marketplace cookie jar.
  if (redirectUrl.pathname === "/reset-password" || searchParams.has("token_hash") || searchParams.get("type") === "recovery") {
    return NextResponse.redirect(new URL("/reset-password", origin), { headers: callbackHeaders });
  }
  if (!code || searchParams.has("error")) return failed();

  const cookieStore = await cookies();
  const current = await createClient(cookieStore).auth.getUser();
  // Confirming an old registration email must not replace a signed-in account.
  if (current.data?.user) {
    return NextResponse.redirect(new URL("/", origin), { headers: callbackHeaders });
  }

  const staged = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie]));
  const writes = [];
  const supabase = createClient({
    getAll: () => [...staged.values()],
    set(name, value, options) {
      staged.set(name, { name, value });
      writes.push({ name, value, options });
    },
  });
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data?.session) return failed();
    if (data.redirectType === "recovery") {
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.redirect(new URL("/reset-password", origin), { headers: callbackHeaders });
    }
    const response = NextResponse.redirect(redirectUrl, { headers: callbackHeaders });
    writes.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    return response;
  } catch {
    return failed();
  }
}
