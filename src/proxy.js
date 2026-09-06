import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

import { isNameChangeRequired } from "@/lib/moderation";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";

export async function proxy(request) {
  let response = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  const isRecoveryRoute =
    ((path === "/reset-password" || path === "/forget-password") && ["GET", "HEAD"].includes(request.method)) ||
    (path === "/api/auth/recovery" && ["GET", "POST"].includes(request.method));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Forward refreshed cookies to the downstream Server Components as
          // well as the browser; otherwise layout can repeat an expired-token
          // refresh whose cookie writes it cannot persist.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          const previousCookies = response.cookies.getAll();
          response = NextResponse.next({ request });
          previousCookies.forEach((cookie) => response.cookies.set(cookie.name, cookie.value, cookie));
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

  // Keep ordinary session refresh above this exception. Recovery never
  // authorizes marketplace access, and bypasses only eligibility gates.
  if (isRecoveryRoute) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  const isBannedRoute = path === "/banned";
  const isAccountStandingRoute = path === "/dashboard/standing";
  const isAccountDeleteRoute =
    path === "/api/account/delete" && request.method === "POST";
  const isBannedAccountAllowedRoute =
    isBannedRoute || isAccountStandingRoute || isAccountDeleteRoute;

  function isProtectedRoute(pathname) {
    return (
      pathname === "/profile" ||
      pathname.startsWith("/dashboard") ||
      pathname === "/listings/create" ||
      /^\/listings\/[^/]+\/edit$/.test(pathname)
    );
  }

  if (user) {
    const userStatusResult = await getUserStatusRow(supabase, user.id);
    const userStatusUnavailable =
      userStatusResult.available !== true || Boolean(userStatusResult.error);

    if (userStatusUnavailable && !isBannedAccountAllowedRoute) {
      const unavailableResponse = NextResponse.json(
        { error: "Account status is temporarily unavailable." },
        { status: 503 },
      );
      response.cookies.getAll().forEach((cookie) => {
        unavailableResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return unavailableResponse;
    }

    if (isUserBanned(userStatusResult.data) && !isBannedAccountAllowedRoute) {
      const redirectResponse = NextResponse.redirect(new URL("/banned", request.url));
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }

    if (!userStatusUnavailable && !isUserBanned(userStatusResult.data) && isBannedRoute) {
      const redirectResponse = NextResponse.redirect(new URL("/", request.url));
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }

    const isNameChangeAllowedRoute =
      path === "/dashboard/profile" ||
      path === "/auth/callback" ||
      path === "/api/account/name" ||
      isAccountDeleteRoute;

    if (
      isNameChangeRequired(user) &&
      !isNameChangeAllowedRoute &&
      !isBannedAccountAllowedRoute
    ) {
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
