"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  HistoryIcon,
  ScaleIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import {
  ACCOUNT_STANDING_ACTIONS,
  performAccountStandingAction,
} from "@/lib/account-standing-client.mjs";
import {
  deriveAccountStanding,
  isModerationNoticeActive,
} from "@/lib/account-standing.mjs";
import { getTranslatedReportReason } from "@/lib/moderation";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";

const STATUS_STYLES = {
  good: {
    icon: ShieldCheckIcon,
    shell: "border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100",
    iconShell: "bg-emerald-600 text-white dark:bg-emerald-400 dark:text-emerald-950",
  },
  action_needed: {
    icon: CircleAlertIcon,
    shell: "border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100",
    iconShell: "bg-amber-500 text-amber-950 dark:bg-amber-300",
  },
  restricted: {
    icon: ShieldAlertIcon,
    shell: "border-orange-200 bg-orange-50/90 text-orange-950 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-100",
    iconShell: "bg-orange-600 text-white dark:bg-orange-400 dark:text-orange-950",
  },
  banned: {
    icon: BanIcon,
    shell: "border-red-200 bg-red-50/90 text-red-950 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-100",
    iconShell: "bg-red-600 text-white dark:bg-red-400 dark:text-red-950",
  },
};

const SEVERITY_STYLES = {
  low: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200",
  medium: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200",
  high: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-200",
  critical: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200",
};

function getStatusCopy(status, t) {
  switch (status) {
    case "banned":
      return { title: t.standingBanned, description: t.standingBannedDescription };
    case "restricted":
      return { title: t.standingRestricted, description: t.standingRestrictedDescription };
    case "action_needed":
      return { title: t.standingActionNeeded, description: t.standingActionNeededDescription };
    case "good":
    default:
      return { title: t.standingGood, description: t.standingGoodDescription };
  }
}

function getSanctionLabel(type, t) {
  if (type === "ban") return t.standingBan;
  if (type === "strike") return t.standingStrike;
  return t.standingWarning;
}

function getSeverityLabel(severity, t) {
  if (severity === "critical") return t.standingSeverityCritical;
  if (severity === "high") return t.standingSeverityHigh;
  if (severity === "medium") return t.standingSeverityMedium;
  return t.standingSeverityLow;
}

function getPolicyLabel(reasonCode, t) {
  const translated = getTranslatedReportReason(reasonCode, t);
  return translated === reasonCode ? reasonCode.replaceAll("_", " ") : translated;
}

function getLifecycleLabel(state, t) {
  switch (state) {
    case "acknowledged": return t.standingLifecycleAcknowledged;
    case "expired": return t.standingLifecycleExpired;
    case "revoked": return t.standingLifecycleRevoked;
    case "overturned": return t.standingLifecycleOverturned;
    default: return t.standingLifecycleActive;
  }
}

function getReviewLabel(state, t) {
  switch (state) {
    case "pending": return t.standingReviewPending;
    case "upheld": return t.standingReviewUpheld;
    case "modified": return t.standingReviewModified;
    case "overturned": return t.standingReviewOverturned;
    default: return null;
  }
}

function humanizeRestriction(value, t, depth = 0) {
  if (typeof value === "boolean") return value ? t.standingYes : t.standingNo;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") {
    const normalized = value.trim().replaceAll("_", " ");
    return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map((entry) => humanizeRestriction(entry, t, depth + 1))
      .join(", ");
  }
  if (value && typeof value === "object") {
    if (depth >= 2) return t.standingConfigured;
    return Object.entries(value)
      .slice(0, 8)
      .map(([key, entry]) => (
        `${key.replaceAll("_", " ")}: ${humanizeRestriction(entry, t, depth + 1)}`
      ))
      .join("; ");
  }
  return "—";
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/80 bg-muted/35 px-3 py-2.5">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 break-words text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

function NoticeCard({ notice, busyAction, onAction, t, language }) {
  const active = isModerationNoticeActive(notice);
  const canAcknowledge = active
    && notice.acknowledgementRequired
    && !notice.acknowledgedAt
    && (!notice.reviewStatus || notice.reviewStatus === "pending");
  const canRequestReview = active && !notice.reviewRequestedAt;
  const restrictionEntries = Object.entries(notice.restrictions ?? {});
  const reviewLabel = getReviewLabel(notice.reviewStatus, t);
  const isBusy = busyAction?.sanctionId === notice.id;

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:rounded-3xl">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border px-3.5 py-3 md:px-5 md:py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
              {getSanctionLabel(notice.sanctionType, t)}
            </h3>
            <Badge variant="outline" className={cn("rounded-full", SEVERITY_STYLES[notice.severity])}>
              {getSeverityLabel(notice.severity, t)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {getLifecycleLabel(notice.lifecycleState, t)}
          </p>
        </div>
        <ScaleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      </div>

      <div className="space-y-3 px-3.5 py-3 md:space-y-4 md:px-5 md:py-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-5 text-foreground md:leading-6">
          {notice.userMessage}
        </p>

        <dl className="grid min-w-0 grid-cols-2 gap-2">
          <Detail label={t.standingPolicy}>
            {getPolicyLabel(notice.reasonCode, t)}
          </Detail>
          <Detail label={t.standingEffectiveDate}>
            {notice.startsAt ? (
              <ClientFormattedDateTime value={notice.startsAt} language={language} />
            ) : "—"}
          </Detail>
          <Detail label={t.standingExpiry}>
            {notice.expiresAt ? (
              <ClientFormattedDateTime value={notice.expiresAt} language={language} />
            ) : t.standingPermanent}
          </Detail>
          <Detail label={t.standingPoints}>
            {notice.strikePoints ?? 0}
          </Detail>
        </dl>

        {restrictionEntries.length > 0 ? (
          <div className="rounded-xl border border-orange-200 bg-orange-50/70 px-3 py-2.5 dark:border-orange-500/20 dark:bg-orange-500/10">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-orange-800 dark:text-orange-200">
              {t.standingRestrictions}
            </p>
            <ul className="mt-2 space-y-1.5">
              {restrictionEntries.map(([key, value]) => (
                <li key={key} className="flex min-w-0 items-start justify-between gap-3 text-xs">
                  <span className="break-words font-medium capitalize text-foreground">
                    {key.replaceAll("_", " ")}
                  </span>
                  <span className="min-w-0 break-all text-right text-muted-foreground">
                    {humanizeRestriction(value, t)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {notice.reviewStatus ? (
          <div className="rounded-xl border border-border bg-muted/25 px-3 py-2.5 text-xs leading-5">
            <p className="font-semibold text-foreground">{reviewLabel}</p>
            {notice.reviewOutcomeMessage ? (
              <p className="mt-1 break-words text-muted-foreground">
                {notice.reviewOutcomeMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        {notice.acknowledgementRequired || notice.reviewRequestedAt ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            {notice.acknowledgementRequired ? (
              <Detail label={t.standingAcknowledgement}>
                {notice.acknowledgedAt ? (
                  <span className="inline-flex flex-wrap gap-x-1">
                    {t.standingAcknowledgedOn}
                    <ClientFormattedDateTime
                      value={notice.acknowledgedAt}
                      language={language}
                    />
                  </span>
                ) : t.standingAwaitingAcknowledgement}
              </Detail>
            ) : null}
            {notice.reviewRequestedAt ? (
              <Detail label={t.standingReviewRequestedOn}>
                <ClientFormattedDateTime
                  value={notice.reviewRequestedAt}
                  language={language}
                />
              </Detail>
            ) : null}
          </dl>
        ) : null}

        {canAcknowledge || canRequestReview ? (
          <div className="grid gap-2 border-t border-border pt-3 sm:flex sm:flex-wrap">
            {canAcknowledge ? (
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() => onAction(ACCOUNT_STANDING_ACTIONS.acknowledge, notice.id)}
                className="min-h-10 rounded-xl px-4"
              >
                <CheckCircle2Icon aria-hidden="true" />
                {isBusy && busyAction.action === ACCOUNT_STANDING_ACTIONS.acknowledge
                  ? t.standingAcknowledging
                  : t.standingAcknowledge}
              </Button>
            ) : null}
            {canRequestReview ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busyAction)}
                onClick={() => onAction(ACCOUNT_STANDING_ACTIONS.requestReview, notice.id)}
                className="min-h-10 rounded-xl px-4"
              >
                <ScaleIcon aria-hidden="true" />
                {isBusy && busyAction.action === ACCOUNT_STANDING_ACTIONS.requestReview
                  ? t.standingRequestingReview
                  : t.standingRequestReview}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function HistoryRow({ notice, t, language }) {
  const reviewLabel = getReviewLabel(notice.reviewStatus, t);

  return (
    <li className="grid min-w-0 gap-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {getSanctionLabel(notice.sanctionType, t)}
          </p>
          <Badge variant="outline" className="rounded-full text-[0.65rem]">
            {getLifecycleLabel(notice.lifecycleState, t)}
          </Badge>
          <Badge
            variant="outline"
            className={cn("rounded-full text-[0.65rem]", SEVERITY_STYLES[notice.severity])}
          >
            {getSeverityLabel(notice.severity, t)}
          </Badge>
          {reviewLabel ? (
            <Badge variant="outline" className="rounded-full text-[0.65rem]">
              {reviewLabel}
            </Badge>
          ) : null}
          {notice.strikePoints ? (
            <span className="text-xs font-medium text-muted-foreground">
              {notice.strikePoints} {t.standingPointsShort}
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
          {notice.userMessage}
        </p>
        {notice.reviewOutcomeMessage ? (
          <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
            {t.standingReviewOutcome}: {notice.reviewOutcomeMessage}
          </p>
        ) : null}
        {notice.revocationReason ? (
          <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
            {t.standingRevocationOutcome}: {notice.revocationReason}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:justify-end">
        <Clock3Icon aria-hidden="true" className="size-3.5" />
        {notice.startsAt ? (
          <ClientFormattedDateTime value={notice.startsAt} language={language} variant="date" />
        ) : "—"}
      </div>
    </li>
  );
}

function getStandingPageHref(activePage, historyPage) {
  const params = new URLSearchParams();

  if (activePage > 1) params.set("activePage", String(activePage));
  if (historyPage > 1) params.set("page", String(historyPage));

  const query = params.toString();
  return query ? `/dashboard/standing?${query}` : "/dashboard/standing";
}

export function AccountStandingContent({
  activeNotices,
  historyNotices,
  authoritativeSummary,
  currentStatus,
  activeCount,
  activePage,
  activePageCount,
  activePageSize,
  historyPage,
  historyPageCount,
  loadError = false,
}) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [busyAction, setBusyAction] = React.useState(null);
  const [actionMessage, setActionMessage] = React.useState("");
  const [, startTransition] = React.useTransition();
  const standing = React.useMemo(
    () => deriveAccountStanding(activeNotices, currentStatus, undefined, authoritativeSummary),
    [activeNotices, authoritativeSummary, currentStatus],
  );
  const statusStyle = STATUS_STYLES[standing.status] ?? STATUS_STYLES.good;
  const StatusIcon = statusStyle.icon;
  const statusCopy = getStatusCopy(standing.status, t);

  async function handleAction(action, sanctionId) {
    if (busyAction) return;

    setBusyAction({ action, sanctionId });
    setActionMessage("");

    let error = null;

    try {
      ({ error } = await performAccountStandingAction(supabase, action, sanctionId));
    } catch {
      error = new Error("account_standing_action_failed");
    }

    if (error) {
      const message = action === ACCOUNT_STANDING_ACTIONS.acknowledge
        ? t.standingAcknowledgeError
        : t.standingReviewError;
      setActionMessage(message);
      toast.error(message);
      setBusyAction(null);
      return;
    }

    const message = action === ACCOUNT_STANDING_ACTIONS.acknowledge
      ? t.standingAcknowledgeSuccess
      : t.standingReviewSuccess;
    setActionMessage(message);
    toast.success(message);
    startTransition(() => router.refresh());
    setBusyAction(null);
  }

  if (loadError) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:rounded-3xl md:p-6">
        <div className="flex items-start gap-3">
          <ShieldXIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">{t.standingLoadErrorTitle}</h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {t.standingLoadErrorDescription}
            </p>
            <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={() => router.refresh()}>
              {t.standingRefresh}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const metricCards = [
    { label: t.standingActiveNotices, value: standing.metrics.activeNotices },
    { label: t.standingStrikePoints, value: standing.metrics.strikePoints },
    { label: t.standingNeedsAcknowledgement, value: standing.metrics.needsAcknowledgement },
    { label: t.standingReviewsPending, value: standing.metrics.pendingReviews },
  ];
  const activeRangeFrom = activeCount > 0
    ? ((activePage - 1) * activePageSize) + 1
    : 0;
  const activeRangeTo = Math.min(activePage * activePageSize, activeCount);
  const activePageDescription = t.standingActivePageDescription
    .replace("{from}", String(activeRangeFrom))
    .replace("{to}", String(activeRangeTo))
    .replace("{count}", String(activeCount));

  return (
    <div className="flex min-w-0 flex-col gap-3 md:gap-5">
      <section className={cn("overflow-hidden rounded-2xl border shadow-sm md:rounded-3xl", statusStyle.shell)}>
        <div className="grid min-w-0 gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-6 md:py-6">
          <div className="flex min-w-0 items-start gap-3 md:gap-4">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl md:size-12 md:rounded-2xl", statusStyle.iconShell)}>
              <StatusIcon aria-hidden="true" className="size-5 md:size-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] opacity-70">
                  {t.accountStanding}
                </p>
                {standing.metrics.needsAcknowledgement > 0 ? (
                  <Badge className="rounded-full border-0 bg-current/10 text-current hover:bg-current/10">
                    {t.standingActionRequired}
                  </Badge>
                ) : null}
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
                {statusCopy.title}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-5 opacity-80 md:text-base md:leading-6">
                {statusCopy.description}
              </p>
            </div>
          </div>
          <SparklesIcon aria-hidden="true" className="hidden size-8 opacity-30 md:block" />
        </div>
      </section>

      <section aria-label={t.standingSummary} className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {metricCards.map((metric) => (
          <div key={metric.label} className="min-w-0 rounded-2xl border border-border bg-card px-3 py-3 shadow-sm md:px-4 md:py-4">
            <p className="min-h-8 break-words text-[0.65rem] font-semibold uppercase leading-4 tracking-[0.14em] text-muted-foreground md:min-h-0">
              {metric.label}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              {metric.value}
            </p>
          </div>
        ))}
      </section>

      <p aria-live="polite" className="sr-only">{actionMessage}</p>

      <section className="min-w-0">
        <div className="mb-2 px-1 md:mb-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">
            {t.standingActiveTitle}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:text-sm">
            {t.standingActiveDescription}
          </p>
          {activeCount > 0 ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {activePageDescription}
            </p>
          ) : null}
        </div>

        {standing.activeNotices.length > 0 ? (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {standing.activeNotices.map((notice) => (
              <NoticeCard
                key={notice.id}
                notice={notice}
                busyAction={busyAction}
                onAction={handleAction}
                t={t}
                language={language}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-7 text-center md:rounded-3xl md:py-10">
            <ShieldCheckIcon aria-hidden="true" className="mx-auto size-8 text-emerald-600 dark:text-emerald-400" />
            <h3 className="mt-3 text-base font-semibold text-foreground">{t.standingNoActiveTitle}</h3>
            <p className="mx-auto mt-1 max-w-xl text-sm leading-5 text-muted-foreground">
              {t.standingNoActiveDescription}
            </p>
          </div>
        )}

        {activePageCount > 1 ? (
          <nav
            aria-label={t.standingActivePagination}
            className="mt-3 flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-3 shadow-sm md:px-4"
          >
            {activePage <= 1 ? (
              <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled>
                {t.previousPage}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link href={getStandingPageHref(activePage - 1, historyPage)}>
                  {t.previousPage}
                </Link>
              </Button>
            )}
            <span className="min-w-0 text-center text-xs font-medium text-muted-foreground">
              {t.standingPageOf
                .replace("{page}", String(activePage))
                .replace("{pages}", String(activePageCount))}
            </span>
            {activePage >= activePageCount ? (
              <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled>
                {t.nextPage}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link href={getStandingPageHref(activePage + 1, historyPage)}>
                  {t.nextPage}
                </Link>
              </Button>
            )}
          </nav>
        ) : null}
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-border px-3.5 py-3 md:px-5 md:py-4">
          <HistoryIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground md:text-lg">
              {t.standingHistoryTitle}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground md:text-sm">
              {t.standingHistoryDescription}
            </p>
          </div>
        </div>

        {historyNotices.length > 0 ? (
          <ul className="divide-y divide-border">
            {historyNotices.map((notice) => (
              <HistoryRow key={notice.id} notice={notice} t={t} language={language} />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t.standingHistoryEmpty}
          </div>
        )}

        {historyPageCount > 1 ? (
          <nav aria-label={t.standingHistoryPagination} className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-3 md:px-5">
            {historyPage <= 1 ? (
              <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled>
                {t.previousPage}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link href={getStandingPageHref(activePage, historyPage - 1)}>
                  {t.previousPage}
                </Link>
              </Button>
            )}
            <span className="text-xs font-medium text-muted-foreground">
              {t.standingPageOf
                .replace("{page}", String(historyPage))
                .replace("{pages}", String(historyPageCount))}
            </span>
            {historyPage >= historyPageCount ? (
              <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled>
                {t.nextPage}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link href={getStandingPageHref(activePage, historyPage + 1)}>
                  {t.nextPage}
                </Link>
              </Button>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
