import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Flag,
  MessageSquareText,
  Search,
} from "lucide-react";
import Link from "next/link";

import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  ADMIN_CONVERSATION_FILTERS,
  buildAdminConversationRegistryHref,
} from "@/lib/admin-conversations.mjs";
import { cn } from "@/lib/utils";

function formatDate(value, language) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getFilterLabel(filter, t) {
  return {
    all: t.adminConversationsFilterAll,
    open: t.adminConversationsFilterOpen,
    closed: t.adminConversationsFilterClosed,
    reopened: t.adminConversationsFilterReopened,
    reported: t.adminConversationsFilterReported,
  }[filter];
}

function StateBadge({ conversation, t }) {
  const isClosed = conversation.moderationState.effectiveStatus === "closed";
  const label = isClosed
    ? t.adminConversationsClosedStatus
    : conversation.moderationState.lastAction === "reopen"
      ? t.adminConversationsReopenedStatus
      : t.adminConversationsOpenStatus;

  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-xs",
        isClosed
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
      )}
    >
      {label}
    </Badge>
  );
}

function ParticipantPair({ conversation, t, compact = false }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex shrink-0 -space-x-2">
        {[conversation.buyer, conversation.seller].map((participant) => (
          <ProfileAvatar
            key={participant.id}
            name={participant.name || t.student}
            avatarPresetId={participant.avatarPresetId}
            avatarUrl={participant.avatarUrl}
            className="size-9 border-2 border-background"
            imageSizes="36px"
          />
        ))}
      </div>
      <div className="min-w-0">
        <p className={cn("truncate font-medium text-foreground", compact ? "text-sm" : "text-base")}>
          {conversation.buyer.name || t.student}
          <span className="px-1 text-muted-foreground">·</span>
          {conversation.seller.name || t.student}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[conversation.buyer.school, conversation.seller.school].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

export function AdminConversationRegistry({
  conversations,
  totalCount,
  filter,
  search,
  page,
  totalPages,
  loadError,
  language,
  t,
}) {
  const previousHref = buildAdminConversationRegistryHref({
    filter,
    search,
    page: Math.max(1, page - 1),
  });
  const nextHref = buildAdminConversationRegistryHref({
    filter,
    search,
    page: Math.min(Math.max(1, totalPages), page + 1),
  });

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-100 px-3 py-4 dark:bg-background sm:px-5 md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <header className="rounded-[1.75rem] border border-zinc-200 bg-white px-4 py-4 shadow-sm dark:border-border dark:bg-card sm:px-5 md:rounded-[2rem] md:px-7 md:py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Button asChild variant="ghost" className="-ml-2 mb-2 h-9 rounded-full px-3">
                <Link href="/admin">
                  <ArrowLeft className="size-4" />
                  {t.backToAdminOverview}
                </Link>
              </Button>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                {t.adminConversationsTitle}
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                {t.adminConversationsDescription}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t.adminConversationsTotalLabel}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {totalCount}
              </p>
            </div>
          </div>
        </header>

        <section className="overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card md:rounded-[2rem]">
          <div className="space-y-3 border-b border-border px-4 py-4 sm:px-5 md:px-6">
            <nav aria-label={t.adminConversationsFilterLabel} className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-max gap-2">
                {ADMIN_CONVERSATION_FILTERS.map((filterValue) => (
                  <Button
                    key={filterValue}
                    asChild
                    size="sm"
                    variant={filter === filterValue ? "default" : "outline"}
                    className="h-9 rounded-full px-4"
                  >
                    <Link
                      href={buildAdminConversationRegistryHref({
                        filter: filterValue,
                        search,
                        page: 1,
                      })}
                    >
                      {getFilterLabel(filterValue, t)}
                    </Link>
                  </Button>
                ))}
              </div>
            </nav>

            <form
              action="/admin/conversations"
              className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
              role="search"
            >
              {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t.adminConversationsSearchLabel}</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={search}
                  maxLength={100}
                  placeholder={t.adminConversationsSearchPlaceholder}
                  className="h-11 rounded-full pl-10"
                />
              </label>
              <Button
                type="submit"
                className="h-11 w-full rounded-full px-5 sm:min-w-28 sm:w-auto"
              >
                {t.adminConversationsSearchAction}
              </Button>
            </form>
            <p className="px-1 text-xs leading-5 text-muted-foreground">
              {t.adminConversationsWindowHint}
            </p>
          </div>

          {loadError ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
              <AlertTriangle className="size-8 text-amber-600" />
              <h2 className="mt-3 text-lg font-semibold text-foreground">
                {t.adminConversationsLoadErrorTitle}
              </h2>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                {t.adminConversationsLoadErrorDescription}
              </p>
              <Button asChild variant="outline" className="mt-5 rounded-full">
                <Link href={buildAdminConversationRegistryHref({ filter, search, page })}>
                  {t.standingRefresh}
                </Link>
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
              <MessageSquareText className="size-9 text-muted-foreground" />
              <h2 className="mt-3 text-lg font-semibold text-foreground">
                {t.adminConversationsEmptyTitle}
              </h2>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                {t.adminConversationsEmptyDescription}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3 p-3 lg:hidden">
                {conversations.map((conversation) => (
                  <article
                    key={conversation.id}
                    className="min-w-0 rounded-2xl border border-border bg-background p-4"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <ParticipantPair conversation={conversation} t={t} compact />
                      <StateBadge conversation={conversation} t={t} />
                    </div>
                    <div className="mt-3 min-w-0 rounded-xl bg-muted/35 px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {conversation.listing.title || t.listing}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {conversation.lastMessagePreview || t.adminConversationsNoMessagePreview}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="size-3.5" />
                        {formatDate(conversation.lastActivityAt, language)}
                      </span>
                      {conversation.openReportCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-red-600 dark:text-red-300">
                          <Flag className="size-3.5" />
                          {conversation.openReportCount}
                        </span>
                      ) : null}
                    </div>
                    <Button asChild className="mt-3 h-10 w-full rounded-xl">
                      <Link href={`/admin/conversations/${conversation.id}`}>
                        {t.adminConversationsReviewAction}
                      </Link>
                    </Button>
                  </article>
                ))}
              </div>

              <div className="hidden lg:block">
                <div className="grid grid-cols-[minmax(250px,1.35fr)_minmax(210px,1fr)_130px_160px_100px] gap-4 border-b border-border bg-muted/20 px-6 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>{t.adminParticipantsTitle}</span>
                  <span>{t.listing}</span>
                  <span>{t.status}</span>
                  <span>{t.adminConversationsLastActivity}</span>
                  <span className="text-right">{t.adminReportsCountLabel}</span>
                </div>
                {conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/admin/conversations/${conversation.id}`}
                    className="grid min-w-0 grid-cols-[minmax(250px,1.35fr)_minmax(210px,1fr)_130px_160px_100px] items-center gap-4 border-b border-border px-6 py-4 transition-colors last:border-b-0 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <ParticipantPair conversation={conversation} t={t} compact />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {conversation.listing.title || t.listing}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {conversation.lastMessagePreview || t.adminConversationsNoMessagePreview}
                      </p>
                    </div>
                    <StateBadge conversation={conversation} t={t} />
                    <span className="text-sm text-muted-foreground">
                      {formatDate(conversation.lastActivityAt, language)}
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                      {conversation.openReportCount}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {!loadError && totalPages > 1 ? (
            <div className="border-t border-border px-4 py-4">
              <Pagination aria-label={t.adminConversationsPaginationLabel}>
                <PaginationContent>
                  <PaginationItem>
                    {page > 1 ? (
                      <PaginationPrevious href={previousHref} text={t.previous} />
                    ) : (
                      <span className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground opacity-50">
                        {t.previous}
                      </span>
                    )}
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-2 text-sm tabular-nums text-muted-foreground">
                      {t.adminConversationsPageSummary
                        .replace("{page}", String(page))
                        .replace("{count}", String(totalPages))}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    {page < totalPages ? (
                      <PaginationNext href={nextHref} text={t.next} />
                    ) : (
                      <span className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground opacity-50">
                        {t.next}
                      </span>
                    )}
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
