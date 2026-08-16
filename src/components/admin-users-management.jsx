"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";
import {
  BAN_REASON_CODE_VALUES,
  BAN_REASON_MESSAGE_MAX_LENGTH,
  BAN_REASON_MESSAGE_MIN_LENGTH,
  validateBanReason,
} from "@/lib/moderation-policy.mjs";

function getRoleLabel(role, t) {
  switch (role) {
    case "admin":
      return t.adminUserRoleAdmin;
    case "moderator":
      return t.adminUserRoleModerator;
    case "staff":
      return t.adminUserRoleStaff;
    default:
      return t.adminUserRoleStandard;
  }
}

function getStatusLabel(user, t) {
  if (user.isBanned) {
    return t.adminUserStatusBanned;
  }

  if (user.requiresNameChange) {
    return t.adminUserStatusNameChangeRequired;
  }

  return t.adminUserStatusActive;
}

function getSearchText(user, t) {
  return [
    user.name,
    user.email,
    user.school,
    getRoleLabel(user.role, t),
    getStatusLabel(user, t),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function SummaryCard({ title, value, description }) {
  return (
    <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
      <CardContent className="px-6 py-5">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function UserRoleActions({ user, currentUserId, currentUserRole, onRoleUpdated, mobile = false }) {
  const { t } = useLanguage();
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  if (currentUserRole !== "admin") {
    return mobile ? null : <span className="text-sm text-muted-foreground">—</span>;
  }

  if (user.role === "staff") {
    return mobile ? null : <span className="text-sm text-muted-foreground">—</span>;
  }

  async function handleRoleAction(action) {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/users/${user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || t.adminUserRoleActionError);
      }

      await supabase.auth.refreshSession();
      onRoleUpdated?.(user.id, payload);
      router.refresh();

      if (action === "transfer_admin") {
        toast.success(t.adminTransferAdminSuccess);
      } else {
        const nextRoleLabel = getRoleLabel(payload?.nextRole ?? null, t);
        toast.success(`${t.roleUpdatedTo} ${nextRoleLabel}`);
      }
    } catch (error) {
      console.error("Failed to update admin user role:", error);
      toast.error(error.message || t.adminUserRoleActionError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={cn("flex flex-wrap justify-end gap-2", mobile && "contents")}>
      {user.role === "moderator" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("rounded-xl", mobile && "min-w-32 flex-1 px-3")}
          onClick={() => handleRoleAction("remove_moderator")}
          disabled={isSubmitting}
        >
          {t.removeMod}
        </Button>
      ) : user.role !== "admin" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("rounded-xl", mobile && "min-w-32 flex-1 px-3")}
          onClick={() => handleRoleAction("make_moderator")}
          disabled={isSubmitting || user.id === currentUserId}
        >
          {t.makeMod}
        </Button>
      ) : null}

      {user.id !== currentUserId && user.role !== "admin" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              className={cn("rounded-xl", mobile && "min-w-32 flex-1 px-3")}
              disabled={isSubmitting}
            >
              {t.adminTransferAdmin}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.adminTransferAdminTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.adminTransferAdminDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleRoleAction("transfer_admin")}
                disabled={isSubmitting}
              >
                {isSubmitting ? t.saving : t.adminTransferAdmin}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function UserBanActions({ user, currentUserId, currentUserRole, onBanUpdated, mobile = false }) {
  const { t } = useLanguage();
  const fieldId = React.useId();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [pendingBanDuration, setPendingBanDuration] = React.useState("");
  const [pendingBanReasonCode, setPendingBanReasonCode] = React.useState("");
  const [pendingBanMessage, setPendingBanMessage] = React.useState("");
  const banOperationRef = React.useRef(null);

  if (currentUserRole !== "admin") {
    return null;
  }

  if (user.id === currentUserId || user.role === "admin") {
    return null;
  }

  const banReasonLabels = {
    spam: t.adminBanReasonSpam,
    scam: t.adminBanReasonScam,
    misleading: t.adminBanReasonMisleading,
    prohibited: t.adminBanReasonProhibited,
    harassment: t.adminBanReasonHarassment,
    inappropriate: t.adminBanReasonInappropriate,
    other: t.adminBanReasonOther,
  };
  const banMessageLength = Array.from(pendingBanMessage).length;
  const banReasonValidation = validateBanReason({
    reasonCode: pendingBanReasonCode,
    userMessage: pendingBanMessage,
  });
  const normalizedBanMessage = banReasonValidation.userMessage;
  const isBanReasonComplete = banReasonValidation.ok;

  function resetBanDialog() {
    banOperationRef.current = null;
    setPendingBanDuration("");
    setPendingBanReasonCode("");
    setPendingBanMessage("");
  }

  async function submitBanAction(action, duration = null) {
    if (isSubmitting) {
      return;
    }

    if (action === "ban" && !isBanReasonComplete) {
      toast.error(t.adminBanReasonValidationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const operationPayloadKey = JSON.stringify({
        action,
        duration,
        reasonCode: action === "ban" ? pendingBanReasonCode : null,
        userMessage: action === "ban" ? normalizedBanMessage : null,
      });

      if (banOperationRef.current?.payloadKey !== operationPayloadKey) {
        banOperationRef.current = {
          payloadKey: operationPayloadKey,
          operationId: crypto.randomUUID(),
        };
      }

      const response = await fetch(`/api/admin/users/${user.id}/ban`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operationId: banOperationRef.current.operationId,
          action,
          duration,
          ...(action === "ban"
            ? {
                reasonCode: pendingBanReasonCode,
                userMessage: normalizedBanMessage,
              }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || t.adminUserBanActionError);
      }

      onBanUpdated?.(user.id, payload);
      banOperationRef.current = null;
      toast.success(action === "unban" ? t.userUnbanned : t.userBanned);
      setIsDialogOpen(false);
      resetBanDialog();
    } catch (error) {
      console.error("Failed to update user ban state:", error);
      toast.error(error.message || t.adminUserBanActionError);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user.isBanned) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("rounded-xl", mobile && "min-w-32 flex-1 px-3")}
        onClick={() => submitBanAction("unban")}
        disabled={isSubmitting}
      >
        {t.unban}
      </Button>
    );
  }

  return (
    <AlertDialog
      open={isDialogOpen}
      onOpenChange={(open) => {
        if (isSubmitting) {
          return;
        }

        setIsDialogOpen(open);
        if (!open) {
          resetBanDialog();
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("rounded-xl", mobile && "min-w-32 flex-1 px-3")}
          disabled={isSubmitting}
        >
          {t.banUser}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="max-w-xl p-0 sm:p-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitBanAction("ban", pendingBanDuration);
          }}
          className="grid min-w-0 gap-0"
        >
          <AlertDialogHeader className="border-b border-border px-4 py-4 sm:px-6 sm:py-5">
            <AlertDialogTitle>{t.adminBanUserTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.adminBanUserDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid min-w-0 gap-5 px-4 py-5 sm:px-6">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${fieldId}-ban-duration`}>
                {t.adminBanDurationLabel}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </Label>
              <NativeSelect
                id={`${fieldId}-ban-duration`}
                value={pendingBanDuration}
                onChange={(event) => setPendingBanDuration(event.target.value)}
                className="w-full"
                required
              >
                <NativeSelectOption value="" disabled>
                  {t.adminBanDurationPlaceholder}
                </NativeSelectOption>
                <NativeSelectOption value="24h">{t.adminBanDuration24Hours}</NativeSelectOption>
                <NativeSelectOption value="7d">{t.adminBanDuration7Days}</NativeSelectOption>
                <NativeSelectOption value="30d">{t.adminBanDuration30Days}</NativeSelectOption>
                <NativeSelectOption value="permanent">
                  {t.adminBanDurationPermanent}
                </NativeSelectOption>
              </NativeSelect>
            </div>

            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${fieldId}-ban-reason`}>
                {t.adminBanReasonLabel}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </Label>
              <p id={`${fieldId}-ban-reason-help`} className="text-xs leading-relaxed text-muted-foreground">
                {t.adminBanReasonDescription}
              </p>
              <NativeSelect
                id={`${fieldId}-ban-reason`}
                value={pendingBanReasonCode}
                onChange={(event) => setPendingBanReasonCode(event.target.value)}
                className="w-full"
                aria-describedby={`${fieldId}-ban-reason-help`}
                required
              >
                <NativeSelectOption value="" disabled>
                  {t.adminBanReasonPlaceholder}
                </NativeSelectOption>
                {BAN_REASON_CODE_VALUES.map((reasonCode) => (
                  <NativeSelectOption key={reasonCode} value={reasonCode}>
                    {banReasonLabels[reasonCode] ?? reasonCode}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="grid min-w-0 gap-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <Label htmlFor={`${fieldId}-ban-message`}>
                  {t.adminBanMessageLabel}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {banMessageLength}/{BAN_REASON_MESSAGE_MAX_LENGTH}
                </span>
              </div>
              <p id={`${fieldId}-ban-message-help`} className="text-xs leading-relaxed text-muted-foreground">
                {t.adminBanMessageDescription}
              </p>
              <Textarea
                id={`${fieldId}-ban-message`}
                value={pendingBanMessage}
                onChange={(event) => {
                  const nextMessage = Array.from(event.target.value)
                    .slice(0, BAN_REASON_MESSAGE_MAX_LENGTH)
                    .join("");
                  setPendingBanMessage(nextMessage);
                }}
                placeholder={t.adminBanMessagePlaceholder}
                className="min-h-28 resize-y"
                rows={4}
                minLength={BAN_REASON_MESSAGE_MIN_LENGTH}
                aria-describedby={`${fieldId}-ban-message-help`}
                required
              />
            </div>
          </div>

          <AlertDialogFooter className="border-t border-border px-4 py-4 sm:px-6">
            <AlertDialogCancel className="w-full sm:w-auto" disabled={isSubmitting}>
              {t.cancel}
            </AlertDialogCancel>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={isSubmitting || !pendingBanDuration || !isBanReasonComplete}
            >
              {isSubmitting ? t.saving : t.ban}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function hasMobileUserActions(user, currentUserId, currentUserRole) {
  return (
    user.profileExists ||
    (currentUserRole === "admin" && user.id !== currentUserId && user.role !== "admin")
  );
}

function UserMobileList({
  users,
  currentUserId,
  currentUserRole,
  language,
  onRoleUpdated,
  onBanUpdated,
  t,
}) {
  return (
    <div className="space-y-3 lg:hidden" role="list">
      {users.map((user) => (
        <article
          key={user.id}
          className="space-y-3 rounded-2xl border border-border bg-background p-4"
          role="listitem"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{user.name}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Badge
              variant="outline"
              className="shrink-0 rounded-full border-border bg-card px-2.5 py-0.5 text-foreground"
            >
              {getStatusLabel(user, t)}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/35 p-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t.school}</dt>
              <dd className="mt-0.5 line-clamp-2 text-sm font-medium text-foreground">
                {user.school}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t.created}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                <ClientFormattedDateTime value={user.createdAt} language={language} />
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="rounded-full border-border bg-card px-2.5 py-0.5 text-foreground"
            >
              {getRoleLabel(user.role, t)}
            </Badge>
            {user.isBanned && user.bannedUntil ? (
              <p className="text-xs text-muted-foreground">
                {t.adminBannedUntilPrefix}{" "}
                <ClientFormattedDateTime value={user.bannedUntil} language={language} />
              </p>
            ) : null}
          </div>

          {hasMobileUserActions(user, currentUserId, currentUserRole) ? (
            <div
              className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
              role="group"
              aria-label={t.actions}
            >
              {user.profileExists ? (
                <Button asChild variant="outline" size="sm" className="min-w-32 flex-1 rounded-xl px-3">
                  <Link href={`/profile/${user.id}`}>{t.viewProfile}</Link>
                </Button>
              ) : null}
              <UserRoleActions
                user={user}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onRoleUpdated={onRoleUpdated}
                mobile
              />
              <UserBanActions
                user={user}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onBanUpdated={onBanUpdated}
                mobile
              />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function AdminUsersManagement({ users, currentUserId, currentUserRole }) {
  const { t, language } = useLanguage();
  const [userRows, setUserRows] = React.useState(users);
  const [currentViewerRole, setCurrentViewerRole] = React.useState(currentUserRole);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");

  React.useEffect(() => {
    setUserRows(users);
  }, [users]);

  React.useEffect(() => {
    setCurrentViewerRole(currentUserRole);
  }, [currentUserRole]);

  const filteredUsers = React.useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return userRows.filter((user) => {
      if (roleFilter !== "all") {
        if (roleFilter === "standard" && user.role) {
          return false;
        }

        if (roleFilter !== "standard" && user.role !== roleFilter) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      return getSearchText(user, t).includes(normalizedQuery);
    });
  }, [roleFilter, searchQuery, t, userRows]);

  const roleFilterOptions = [
    { value: "all", label: t.all },
    { value: "standard", label: t.adminUserRoleStandard },
    { value: "admin", label: t.adminUserRoleAdmin },
    { value: "moderator", label: t.adminUserRoleModerator },
    { value: "staff", label: t.adminUserRoleStaff },
  ];

  const bannedCount = userRows.filter((user) => user.isBanned).length;
  const moderationUsersCount = userRows.filter((user) => Boolean(user.role)).length;

  function handleRoleUpdated(userId, payload) {
    setUserRows((currentUsers) =>
      currentUsers.map((user) => {
        if (user.id === userId) {
          return {
            ...user,
            role: payload?.nextRole ?? null,
          };
        }

        if (user.id === currentUserId && payload?.currentUserNextRole !== undefined) {
          setCurrentViewerRole(payload.currentUserNextRole);
          return {
            ...user,
            role: payload.currentUserNextRole,
          };
        }

        return user;
      }),
    );
  }

  function handleBanUpdated(userId, payload) {
    setUserRows((currentUsers) =>
      currentUsers.map((user) => {
        if (user.id !== userId) {
          return user;
        }

        return {
          ...user,
          isBanned: Boolean(payload?.isBanned),
          bannedUntil: payload?.bannedUntil ?? null,
        };
      }),
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
        <SummaryCard
          title={t.students}
          value={userRows.length}
          description={t.adminUsersSummaryDescription}
        />
        <SummaryCard
          title={t.adminModerationTeamTitle}
          value={moderationUsersCount}
          description={t.adminModerationTeamDescription}
        />
        <SummaryCard
          title={t.banned}
          value={bannedCount}
          description={t.adminBannedUsersDescription}
        />
      </div>

      <Card className="rounded-3xl bg-card py-0 shadow-sm ring-border">
        <CardContent className="space-y-6 px-6 py-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {roleFilterOptions.map((option) => {
                const isActive = roleFilter === option.value;

                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={cn("rounded-full px-3", !isActive && "bg-background")}
                    onClick={() => setRoleFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>

            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute top-0 bottom-0 left-3 my-auto size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t.adminSearchUsersPlaceholder}
                className="rounded-full bg-background pl-9"
                aria-label={t.adminSearchUsersPlaceholder}
              />
            </div>
          </div>

          {filteredUsers.length > 0 ? (
            <>
              <UserMobileList
                users={filteredUsers}
                currentUserId={currentUserId}
                currentUserRole={currentViewerRole}
                language={language}
                onRoleUpdated={handleRoleUpdated}
                onBanUpdated={handleBanUpdated}
                t={t}
              />
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.name}</TableHead>
                      <TableHead>{t.email}</TableHead>
                      <TableHead>{t.school}</TableHead>
                      <TableHead>{t.statusRole}</TableHead>
                      <TableHead>{t.created}</TableHead>
                      <TableHead className="text-right">{t.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <p className="font-medium text-foreground">{user.name}</p>
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
                        </TableCell>
                        <TableCell>{user.school}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                              {getStatusLabel(user, t)}
                            </Badge>
                            <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                              {getRoleLabel(user.role, t)}
                            </Badge>
                          </div>
                          {user.isBanned && user.bannedUntil ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t.adminBannedUntilPrefix}{" "}
                              <ClientFormattedDateTime value={user.bannedUntil} language={language} />
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <ClientFormattedDateTime
                            value={user.createdAt}
                            language={language}
                            className="text-sm text-muted-foreground"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {user.profileExists ? (
                              <Button asChild variant="outline" size="sm" className="rounded-xl">
                                <Link href={`/profile/${user.id}`}>{t.viewProfile}</Link>
                              </Button>
                            ) : null}
                            <UserRoleActions
                              user={user}
                              currentUserId={currentUserId}
                              currentUserRole={currentViewerRole}
                              onRoleUpdated={handleRoleUpdated}
                            />
                            <UserBanActions
                              user={user}
                              currentUserId={currentUserId}
                              currentUserRole={currentViewerRole}
                              onBanUpdated={handleBanUpdated}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
              {t.adminNoUsersMatchFilters}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
