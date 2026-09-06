"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  FileWarningIcon,
  GavelIcon,
  ListIcon,
  MessageCircleIcon,
  ShieldAlertIcon,
  Undo2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedReportReason } from "@/lib/moderation";
import { BAN_REASON_CODE_VALUES } from "@/lib/moderation-policy.mjs";

function fallback(t, key, value) {
  return t?.[key] ?? value;
}

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The action could not be completed.");
  return body;
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-muted/25 p-3">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      <p className="mt-2 truncate text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function Field({ id, label, required = false, children }) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}{required ? <span aria-hidden="true" className="text-destructive">*</span> : null}</Label>
      {children}
    </div>
  );
}

function ResultCard({ result, t }) {
  if (!result) return null;
  return (
    <section aria-live="polite" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
      <div className="flex items-center gap-2 font-semibold"><CheckCircle2Icon aria-hidden="true" className="size-4" />{fallback(t, "adminSanctionActionSuccess", "Action completed")}</div>
      {result.before || result.current || result.after ? (
        <dl className="mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-xs">
          <div className="min-w-0"><dt className="break-words font-semibold">{fallback(t, "adminLiftBanBefore", "Before")}</dt><dd className="mt-1 break-words">{result.before}</dd></div>
          <div className="min-w-0"><dt className="break-words font-semibold">{fallback(t, "adminLiftBanCurrent", "Current")}</dt><dd className="mt-1 break-words">{result.current}</dd></div>
          <div className="min-w-0"><dt className="break-words font-semibold">{fallback(t, "adminLiftBanAfter", "After")}</dt><dd className="mt-1 break-words">{result.after}</dd></div>
        </dl>
      ) : null}
      <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        <div><dt className="font-semibold">{fallback(t, "adminLiftBanOperation", "Operation")}</dt><dd className="break-all">{result.operationId ?? "—"}</dd></div>
        <div><dt className="font-semibold">{fallback(t, "adminLiftBanAuditRecord", "Audit record")}</dt><dd className="break-all">{result.auditEventId ?? "—"}</dd></div>
      </dl>
      {result.replayed ? <p className="mt-2 text-xs">{fallback(t, "adminLiftBanReplay", "This was a safe replay of the same operation.")}</p> : null}
    </section>
  );
}

function IssueDialog({ type, userId, onComplete, t, currentUserRole }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const operationId = React.useRef(null);
  const isStrike = type === "strike";
  const isModeratorStrike = isStrike && currentUserRole === "moderator";

  const handleOpen = (nextOpen) => {
    setOpen(nextOpen);
    if (nextOpen && !operationId.current) operationId.current = newOperationId();
    if (!nextOpen && !busy) operationId.current = null;
  };

  async function onSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const result = await postJson(`/api/admin/users/${userId}/sanctions`, {
        action: isStrike ? "issue_strike" : "issue_warning",
        operationId: operationId.current,
        severity: form.get("severity"),
        reasonCode: form.get("reasonCode"),
        userMessage: form.get("userMessage"),
        strikePoints: isStrike ? form.get("strikePoints") : undefined,
      });
      onComplete({ ...result, operationId: operationId.current });
      operationId.current = null;
      setOpen(false);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={isStrike ? "default" : "outline"} className="w-full rounded-xl sm:w-auto">
          {isStrike ? <GavelIcon aria-hidden="true" className="size-4" /> : <ShieldAlertIcon aria-hidden="true" className="size-4" />}
          {isStrike ? fallback(t, "adminIssueStrike", "Issue strike") : fallback(t, "adminIssueWarning", "Issue warning")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100%-1rem)] max-w-xl rounded-2xl p-4 sm:p-6">
        <AlertDialogHeader>
          <AlertDialogTitle>{isStrike ? fallback(t, "adminIssueStrike", "Issue strike") : fallback(t, "adminIssueWarning", "Issue warning")}</AlertDialogTitle>
          <AlertDialogDescription>{fallback(t, "adminIssueSanctionDescription", "This user-visible notice is durable, reviewable, and recorded in the audit trail.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${type}-severity`} label={fallback(t, "adminSanctionSeverity", "Severity")} required>
              <NativeSelect id={`${type}-severity`} name="severity" defaultValue="medium" className="w-full" size="sm"><NativeSelectOption value="low">{t.standingSeverityLow}</NativeSelectOption><NativeSelectOption value="medium">{t.standingSeverityMedium}</NativeSelectOption>{isModeratorStrike ? null : <><NativeSelectOption value="high">{t.standingSeverityHigh}</NativeSelectOption><NativeSelectOption value="critical">{t.standingSeverityCritical}</NativeSelectOption></>}</NativeSelect>
            </Field>
            {isStrike ? <Field id="strike-points" label={fallback(t, "adminSanctionStrikePoints", "Strike points")} required><NativeSelect id="strike-points" name="strikePoints" defaultValue="1" className="w-full" size="sm"><NativeSelectOption value="1">1</NativeSelectOption>{isModeratorStrike ? null : <><NativeSelectOption value="2">2</NativeSelectOption><NativeSelectOption value="3">3</NativeSelectOption></>}</NativeSelect></Field> : null}
          </div>
          <Field id={`${type}-reason`} label={t.adminBanReasonLabel} required>
            <NativeSelect id={`${type}-reason`} name="reasonCode" defaultValue="spam" className="w-full" size="sm">{BAN_REASON_CODE_VALUES.map((code) => <NativeSelectOption key={code} value={code}>{getTranslatedReportReason(code, t)}</NativeSelectOption>)}</NativeSelect>
          </Field>
          <Field id={`${type}-message`} label={fallback(t, "adminSanctionUserMessage", "Message shown to the user")} required>
            <Textarea id={`${type}-message`} name="userMessage" required minLength={10} maxLength={1000} className="min-h-28" />
          </Field>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter><AlertDialogCancel type="button" disabled={busy}>{t.cancel}</AlertDialogCancel><Button type="submit" disabled={busy}>{busy ? t.saving : fallback(t, "adminIssueSanction", "Confirm action")}</Button></AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SanctionActionDialog({ action, sanction, userId, onComplete, t }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const operationId = React.useRef(null);
  const isRevoke = action === "revoke";
  const isOverturn = action === "overturn";
  const title = isRevoke ? fallback(t, "adminRevokeSanctionTitle", "Revoke sanction") : action === "uphold" ? fallback(t, "adminReviewUphold", "Uphold review") : fallback(t, "adminReviewOverturn", "Overturn review");

  function handleOpen(nextOpen) {
    setOpen(nextOpen);
    if (nextOpen && !operationId.current) operationId.current = newOperationId();
    if (!nextOpen && !busy) operationId.current = null;
  }

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const result = await postJson(`/api/admin/users/${userId}/sanctions`, {
        action,
        operationId: operationId.current,
        sanctionId: sanction.id,
        outcomeMessage: form.get("outcomeMessage"),
        revocationReason: form.get("revocationReason"),
      });
      onComplete({ ...result, operationId: operationId.current });
      operationId.current = null;
      setOpen(false);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpen}>
      <AlertDialogTrigger asChild><Button size="sm" variant={isOverturn || isRevoke ? "destructive" : "outline"} className="rounded-xl">{isRevoke ? <Undo2Icon aria-hidden="true" className="size-4" /> : null}{title}</Button></AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100%-1rem)] rounded-2xl p-4 sm:p-6">
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{isRevoke ? fallback(t, "adminRevokeSanctionDescription", "This ends the active sanction and records the reason.") : fallback(t, "adminReviewOutcomeDescription", "The user will see this review outcome.")}</AlertDialogDescription></AlertDialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!isRevoke ? <Field id={`${action}-${sanction.id}-outcome`} label={fallback(t, "adminReviewOutcomeMessage", "Outcome shown to the user")} required><Textarea id={`${action}-${sanction.id}-outcome`} name="outcomeMessage" required minLength={10} maxLength={2000} /></Field> : null}
          {(isRevoke || isOverturn) ? <Field id={`${action}-${sanction.id}-reason`} label={fallback(t, "adminRevocationReason", "Revocation reason")} required><Textarea id={`${action}-${sanction.id}-reason`} name="revocationReason" required minLength={10} maxLength={1000} /></Field> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter><AlertDialogCancel type="button" disabled={busy}>{t.cancel}</AlertDialogCancel><Button type="submit" disabled={busy} variant={isRevoke || isOverturn ? "destructive" : "default"}>{busy ? t.saving : title}</Button></AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LiftBanDialog({ user, onComplete, t, language }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const operationId = React.useRef(null);
  function handleOpen(next) { setOpen(next); if (next && !operationId.current) operationId.current = newOperationId(); if (!next && !busy) operationId.current = null; }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const id = operationId.current;
      const result = await postJson(`/api/admin/users/${user.id}/ban`, { action: "unban", operationId: id, revocationReason: form.get("revocationReason") });
      onComplete({ ...result, operationId: id, before: fallback(t, "adminUserAccountBanned", "Banned"), current: fallback(t, "adminLiftBanEffect", "Ban lifted immediately"), after: fallback(t, "adminUserAccountActive", "Active") });
      operationId.current = null; setOpen(false);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return (
    <AlertDialog open={open} onOpenChange={handleOpen}>
      <AlertDialogTrigger asChild><Button variant="destructive" className="w-full rounded-xl"><Undo2Icon aria-hidden="true" className="size-4" />{fallback(t, "adminLiftBanTitle", "Lift ban")}</Button></AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100%-1rem)] rounded-2xl p-4 sm:p-6">
        <AlertDialogHeader><AlertDialogTitle>{fallback(t, "adminLiftBanTitle", "Lift ban")}</AlertDialogTitle><AlertDialogDescription>{fallback(t, "adminLiftBanDescription", "Confirm the effect and provide a reason the user can understand.")}</AlertDialogDescription></AlertDialogHeader>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 text-xs"><div className="min-w-0 rounded-xl bg-muted p-2"><strong className="break-words">{fallback(t, "adminLiftBanBefore", "Before")}</strong><p className="mt-1 break-words">{fallback(t, "adminUserAccountBanned", "Banned")}</p></div><div className="min-w-0 rounded-xl bg-muted p-2"><strong className="break-words">{fallback(t, "adminLiftBanCurrent", "Current")}</strong><p className="mt-1 break-words">{user.bannedUntil ? <ClientFormattedDateTime value={user.bannedUntil} language={language} /> : t.standingPermanent}</p></div><div className="min-w-0 rounded-xl bg-muted p-2"><strong className="break-words">{fallback(t, "adminLiftBanAfter", "After")}</strong><p className="mt-1 break-words">{fallback(t, "adminUserAccountActive", "Active")}</p></div></div>
        <form onSubmit={submit} className="space-y-4">
          <Field id="unban-reason" label={fallback(t, "adminLiftBanReason", "Reason shown to the user")} required><Textarea id="unban-reason" name="revocationReason" required minLength={10} maxLength={1000} placeholder={fallback(t, "adminLiftBanReasonPlaceholder", "Explain why this ban is being lifted...")} /></Field>
          <p className="text-xs text-muted-foreground">{fallback(t, "adminLiftBanReasonValidation", "Required (10-1000 characters).")}</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter><AlertDialogCancel type="button" disabled={busy}>{t.cancel}</AlertDialogCancel><Button type="submit" variant="destructive" disabled={busy}>{busy ? t.saving : fallback(t, "adminLiftBanConfirm", "Confirm unban")}</Button></AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AdminUserDetailContent({ user, currentUserId, currentUserRole, sanctions, page, pageCount, summaries, recentReports, recentListings, loadError, returnHref = "/admin/enforcement" }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [result, setResult] = React.useState(null);
  const isSelf = user.id === currentUserId;
  const targetProtected = user.role === "admin"
    || (currentUserRole === "moderator" && user.role === "moderator");
  const canIssue = ["admin", "moderator"].includes(currentUserRole)
    && !isSelf
    && !targetProtected;
  const canLiftBan = currentUserRole === "admin" && user.isBanned && !isSelf;
  function complete(value) { setResult(value); toast.success(fallback(t, "adminSanctionActionSuccess", "Action completed")); router.refresh(); }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-4">
      <header className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-full"><Link href={returnHref}><ArrowLeftIcon aria-hidden="true" className="size-4" />{t.adminQueueBack}</Link></Button>
        <div className="mt-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{user.name}</h1>{user.role ? <Badge variant="outline">{user.role}</Badge> : null}{user.isBanned ? <Badge variant="destructive">{fallback(t, "adminUserAccountBanned", "Banned")}</Badge> : <Badge variant="secondary">{fallback(t, "adminUserAccountActive", "Active")}</Badge>}</div>{user.email ? <p className="mt-1 break-all text-sm text-muted-foreground">{user.email}</p> : null}<p className="text-sm text-muted-foreground">{user.school}</p></div>
          {canIssue ? <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><IssueDialog type="warning" userId={user.id} onComplete={complete} t={t} currentUserRole={currentUserRole} /><IssueDialog type="strike" userId={user.id} onComplete={complete} t={t} currentUserRole={currentUserRole} /></div> : null}
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-5 text-muted-foreground">
          {fallback(t, "adminUserDetailDescription", "Review this account's standing, marketplace activity, and moderation history.")}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4"><SummaryCard icon={FileWarningIcon} label={fallback(t, "adminUserReportsSummary", "Reports")} value={summaries.reports} /><SummaryCard icon={ListIcon} label={fallback(t, "adminUserListingsSummary", "Listings")} value={summaries.listings} /><SummaryCard icon={MessageCircleIcon} label={fallback(t, "adminUserConversationsSummary", "Conversations")} value={summaries.conversations} /><SummaryCard icon={GavelIcon} label={fallback(t, "adminUserSanctionsSummary", "Sanctions")} value={summaries.sanctions} /></div>
      </header>

      <ResultCard result={result} t={t} />
      {loadError ? <p role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">{t.adminUsersSetupDescription}</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:rounded-3xl">
          <div className="border-b border-border px-4 py-3 sm:px-5"><h2 className="font-semibold">{fallback(t, "adminUserSanctionHistory", "Sanction history")}</h2></div>
          {sanctions.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{fallback(t, "adminUserNoSanctions", "No sanctions recorded.")}</p> : <div className="divide-y divide-border">{sanctions.map((sanction) => {
            const canManage = !isSelf && !targetProtected && (
              currentUserRole === "admin" ||
              (currentUserRole === "moderator" && sanction.sanctionType !== "ban" && sanction.issuedByRole !== "admin")
            );
            return <article key={sanction.id} className="min-w-0 p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{sanction.sanctionType}</Badge><Badge variant="secondary">{sanction.severity}</Badge>{sanction.isActive ? <Badge>{t.standingLifecycleActive}</Badge> : null}{sanction.reviewStatus ? <Badge variant="outline">{sanction.reviewStatus}</Badge> : null}</div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-5">{sanction.userMessage}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground"><div><dt className="font-semibold text-foreground">{t.standingPolicy}</dt><dd>{getTranslatedReportReason(sanction.reasonCode, t)}</dd></div><div><dt className="font-semibold text-foreground">{fallback(t, "adminEnforcementIssuedBy", "Issued by")}</dt><dd>{sanction.issuedByName ?? sanction.issuedByRole}</dd></div><div><dt className="font-semibold text-foreground">{t.standingEffectiveDate}</dt><dd><ClientFormattedDateTime value={sanction.startsAt} language={language} /></dd></div><div><dt className="font-semibold text-foreground">{t.standingExpiry}</dt><dd>{sanction.expiresAt ? <ClientFormattedDateTime value={sanction.expiresAt} language={language} /> : t.standingPermanent}</dd></div></dl>{canManage ? <div className="mt-3 flex flex-wrap gap-2">{sanction.isActive && !sanction.revokedAt && sanction.sanctionType !== "ban" ? <SanctionActionDialog action="revoke" sanction={sanction} userId={user.id} onComplete={complete} t={t} /> : null}{sanction.reviewStatus === "pending" ? <><SanctionActionDialog action="uphold" sanction={sanction} userId={user.id} onComplete={complete} t={t} /><SanctionActionDialog action="overturn" sanction={sanction} userId={user.id} onComplete={complete} t={t} /></> : null}</div> : null}</article>;
          })}</div>}
          {pageCount > 1 ? <nav aria-label="Sanction history pagination" className="flex items-center justify-between gap-3 border-t border-border p-4"><Button asChild={page > 1} disabled={page <= 1} variant="outline" size="sm">{page > 1 ? <Link href={`/admin/users/${user.id}?page=${page - 1}`}>{t.previousPage}</Link> : <span>{t.previousPage}</span>}</Button><span className="text-xs text-muted-foreground">{page} / {pageCount}</span><Button asChild={page < pageCount} disabled={page >= pageCount} variant="outline" size="sm">{page < pageCount ? <Link href={`/admin/users/${user.id}?page=${page + 1}`}>{t.nextPage}</Link> : <span>{t.nextPage}</span>}</Button></nav> : null}
        </section>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:rounded-3xl">
            <h2 className="font-semibold">{fallback(t, "adminUserCurrentStanding", "Current standing")}</h2>
            <dl className="mt-3 space-y-2 text-sm">{user.createdAt ? <div><dt className="text-xs text-muted-foreground">{t.memberSince}</dt><dd><ClientFormattedDateTime value={user.createdAt} language={language} /></dd></div> : null}{user.lastSignInAt ? <div><dt className="text-xs text-muted-foreground">{fallback(t, "adminUserLastSignIn", "Last sign in")}</dt><dd><ClientFormattedDateTime value={user.lastSignInAt} language={language} /></dd></div> : null}{user.emailConfirmedAt ? <div><dt className="text-xs text-muted-foreground">{fallback(t, "adminUserEmailConfirmed", "Email confirmed")}</dt><dd><ClientFormattedDateTime value={user.emailConfirmedAt} language={language} /></dd></div> : null}{user.banReason ? <div><dt className="text-xs text-muted-foreground">{t.accountBannedReasonLabel}</dt><dd className="break-words">{user.banReason}</dd></div> : null}</dl>
            {canLiftBan ? <div className="mt-4"><LiftBanDialog user={user} onComplete={complete} t={t} language={language} /></div> : null}
          </section>
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:rounded-3xl"><h2 className="font-semibold">{fallback(t, "adminUserReportsSummary", "Recent reports")}</h2><ul className="mt-3 space-y-2">{recentReports.length ? recentReports.map((report) => <li key={report.id} className="rounded-xl bg-muted/40 p-3 text-xs"><Link className="font-medium hover:underline" href={`/admin/reports/${report.id}`}>{getTranslatedReportReason(report.reason, t)}</Link><p className="mt-1 text-muted-foreground">{report.subject_type} · {report.status}</p></li>) : <li className="text-sm text-muted-foreground">—</li>}</ul></section>
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:rounded-3xl"><h2 className="font-semibold">{fallback(t, "adminUserListingsSummary", "Recent listings")}</h2><ul className="mt-3 space-y-2">{recentListings.length ? recentListings.map((listing) => <li key={listing.id} className="rounded-xl bg-muted/40 p-3 text-xs"><Link className="break-words font-medium hover:underline" href={`/listings/${listing.slug}`}>{listing.title}</Link><p className="mt-1 text-muted-foreground">{listing.status}</p></li>) : <li className="text-sm text-muted-foreground">—</li>}</ul></section>
        </aside>
      </div>
    </div>
  );
}
