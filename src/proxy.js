import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

import { isNameChangeRequired } from "@/lib/moderation";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";

export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Get the current logged-in user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isBannedRoute = path === "/banned";

  function isProtectedRoute(pathname) {
    return (
      pathname === "/profile" ||
      pathname === "/dashboard" ||
      pathname === "/listings/create" ||
      /^\/listings\/[^/]+\/edit$/.test(pathname)
    );
  }

  if (user) {
    const userStatusResult = await getUserStatusRow(supabase, user.id);

    if (isUserBanned(userStatusResult.data) && !isBannedRoute) {
      const redirectResponse = NextResponse.redirect(new URL("/banned", request.url));
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }

    if (!isUserBanned(userStatusResult.data) && isBannedRoute) {
      const redirectResponse = NextResponse.redirect(new URL("/", request.url));
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }

    const isNameChangeAllowedRoute =
      path === "/dashboard/profile" || path === "/auth/callback" || path.startsWith("/api/");

    if (isNameChangeRequired(user) && !isNameChangeAllowedRoute && !isBannedRoute) {
      const redirectResponse = NextResponse.redirect(new URL("/dashboard/profile", request.url));
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }
  }

  if (!user && isBannedRoute) {
    const redirectResponse = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  // Rule 1: Logged-in users should NOT visit auth-entry pages
  if (user && (path === "/login" || path === "/register" || path === "/forget-password")) {
    const redirectResponse = NextResponse.redirect(new URL("/", request.url));
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  // Rule 2: Logged-out users should NOT visit protected pages
  if (!user && isProtectedRoute(path)) {
    const redirectResponse = NextResponse.redirect(
      new URL("/login", request.url),
    );
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
