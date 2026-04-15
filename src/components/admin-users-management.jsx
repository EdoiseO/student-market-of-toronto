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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";

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
  return user.isBanned ? t.adminUserStatusBanned : t.adminUserStatusActive;
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

function UserRoleActions({ user, currentUserId, currentUserRole, onRoleUpdated }) {
  const { t } = useLanguage();
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  if (currentUserRole !== "admin") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  if (user.role === "staff") {
    return <span className="text-sm text-muted-foreground">—</span>;
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
    <div className="flex flex-wrap justify-end gap-2">
      {user.role === "moderator" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
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
          className="rounded-xl"
          onClick={() => handleRoleAction("make_moderator")}
          disabled={isSubmitting || user.id === currentUserId}
        >
          {t.makeMod}
        </Button>
      ) : null}

      {user.id !== currentUserId && user.role !== "admin" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" className="rounded-xl" disabled={isSubmitting}>
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

function UserBanActions({ user, currentUserId, currentUserRole, onBanUpdated }) {
  const { t } = useLanguage();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [pendingBanDuration, setPendingBanDuration] = React.useState(null);

  if (currentUserRole !== "admin") {
    return null;
  }

  if (user.id === currentUserId || user.role === "admin") {
    return null;
  }

  async function submitBanAction(action, duration = null) {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/users/${user.id}/ban`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, duration }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || t.adminUserBanActionError);
      }

      onBanUpdated?.(user.id, payload);
      toast.success(action === "unban" ? t.userUnbanned : t.userBanned);
    } catch (error) {
      console.error("Failed to update user ban state:", error);
      toast.error(error.message || t.adminUserBanActionError);
    } finally {
      setIsSubmitting(false);
      setPendingBanDuration(null);
      setIsDialogOpen(false);
    }
  }

  if (user.isBanned) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-xl"
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
        setIsDialogOpen(open);
        if (!open) {
          setPendingBanDuration(null);
        }
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled={isSubmitting}>
            {t.banUser}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-2xl">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setPendingBanDuration("24h");
              setIsDialogOpen(true);
            }}
          >
            {t.adminBanDuration24Hours}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setPendingBanDuration("7d");
              setIsDialogOpen(true);
            }}
          >
            {t.adminBanDuration7Days}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setPendingBanDuration("30d");
              setIsDialogOpen(true);
            }}
          >
            {t.adminBanDuration30Days}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setPendingBanDuration("permanent");
              setIsDialogOpen(true);
            }}
          >
            {t.adminBanDurationPermanent}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.adminBanUserTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.adminBanUserDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => submitBanAction("ban", pendingBanDuration)}
            disabled={isSubmitting || !pendingBanDuration}
          >
            {isSubmitting ? t.saving : t.ban}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
                className="h-10 rounded-full bg-background pl-9"
                aria-label={t.adminSearchUsersPlaceholder}
              />
            </div>
          </div>

          {filteredUsers.length > 0 ? (
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
                          {t.adminBannedUntilPrefix} <ClientFormattedDateTime value={user.bannedUntil} language={language} />
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
