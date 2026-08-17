import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AccountStandingContent } from "@/components/account-standing-content";
import {
  ACCOUNT_STANDING_NOTICE_SELECT,
  isAccountStandingSetupMissing,
  normalizeAccountStandingSummary,
  normalizeModerationNotice,
} from "@/lib/account-standing.mjs";
import { getUserStatusRow } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

const HISTORY_PAGE_SIZE = 20;
const ACTIVE_PAGE_SIZE = 20;
const MAX_PAGE_NUMBER = 1_000_000;

function parsePage(value) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_PAGE_NUMBER
    ? parsed
    : 1;
}

function getStandingPageHref(activePage, historyPage) {
  const params = new URLSearchParams();

  if (activePage > 1) params.set("activePage", String(activePage));
  if (historyPage > 1) params.set("page", String(historyPage));

  const query = params.toString();
  return query ? `/dashboard/standing?${query}` : "/dashboard/standing";
}

export default async function AccountStandingPage({ searchParams }) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const resolvedSearchParams = await searchParams;
  const requestedHistoryPage = parsePage(resolvedSearchParams?.page);
  const requestedActivePage = parsePage(resolvedSearchParams?.activePage);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const activeFrom = (requestedActivePage - 1) * ACTIVE_PAGE_SIZE;
  const activeTo = activeFrom + ACTIVE_PAGE_SIZE - 1;
  const historyFrom = (requestedHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const historyTo = historyFrom + HISTORY_PAGE_SIZE - 1;
  const activeQuery = supabase
    .from("user_moderation_notices")
    .select(ACCOUNT_STANDING_NOTICE_SELECT, { count: "exact" })
    .in("lifecycle_state", ["active", "acknowledged"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(activeFrom, activeTo);
  const historyQuery = supabase
    .from("user_moderation_notices")
    .select(ACCOUNT_STANDING_NOTICE_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(historyFrom, historyTo);

  const [activeResult, historyResult, summaryResult, userStatusResult] = await Promise.all([
    activeQuery,
    historyQuery,
    supabase.rpc("get_account_standing_summary").maybeSingle(),
    getUserStatusRow(supabase, user.id),
  ]);

  const noticeError = activeResult.error ?? historyResult.error ?? summaryResult.error;

  if (noticeError && !isAccountStandingSetupMissing(noticeError)) {
    console.error("Failed to load account standing:", noticeError.code ?? "unknown_error");
  }

  if (userStatusResult.error) {
    console.error(
      "Failed to load account standing status:",
      userStatusResult.error.code ?? "unknown_error",
    );
  }

  const historyCount = historyResult.count ?? 0;
  const activeCount = activeResult.count ?? 0;
  const historyPageCount = Math.max(1, Math.ceil(historyCount / HISTORY_PAGE_SIZE));
  const activePageCount = Math.max(1, Math.ceil(activeCount / ACTIVE_PAGE_SIZE));

  if (
    !noticeError
    && (
      requestedHistoryPage > historyPageCount
      || requestedActivePage > activePageCount
    )
  ) {
    redirect(getStandingPageHref(
      Math.min(requestedActivePage, activePageCount),
      Math.min(requestedHistoryPage, historyPageCount),
    ));
  }

  const currentStatus = userStatusResult.data
    ? {
        isBanned: userStatusResult.data.is_banned === true,
        bannedUntil: userStatusResult.data.banned_until ?? null,
      }
    : null;

  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-3 dark:bg-background sm:px-4 md:p-5 lg:p-8">
      <div className="mx-auto w-full max-w-6xl">
        <AccountStandingContent
          activeNotices={(activeResult.data ?? []).map(normalizeModerationNotice)}
          historyNotices={(historyResult.data ?? []).map(normalizeModerationNotice)}
          authoritativeSummary={normalizeAccountStandingSummary(summaryResult.data)}
          currentStatus={currentStatus}
          activeCount={activeCount}
          activePage={requestedActivePage}
          activePageCount={activePageCount}
          activePageSize={ACTIVE_PAGE_SIZE}
          historyPage={requestedHistoryPage}
          historyPageCount={historyPageCount}
          loadError={Boolean(noticeError || userStatusResult.error)}
        />
      </div>
    </main>
  );
}
