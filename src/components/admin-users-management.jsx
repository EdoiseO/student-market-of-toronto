"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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

export function AdminUsersManagement({ users }) {
  const { t, language } = useLanguage();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");

  const filteredUsers = React.useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return users.filter((user) => {
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
  }, [roleFilter, searchQuery, t, users]);

  const roleFilterOptions = [
    { value: "all", label: t.all },
    { value: "standard", label: t.adminUserRoleStandard },
    { value: "admin", label: t.adminUserRoleAdmin },
    { value: "moderator", label: t.adminUserRoleModerator },
    { value: "staff", label: t.adminUserRoleStaff },
  ];

  const bannedCount = users.filter((user) => user.isBanned).length;
  const moderationUsersCount = users.filter((user) => Boolean(user.role)).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
        <SummaryCard
          title={t.students}
          value={users.length}
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
                    </TableCell>
                    <TableCell>
                      <ClientFormattedDateTime
                        value={user.createdAt}
                        language={language}
                        className="text-sm text-muted-foreground"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {user.profileExists ? (
                        <Button asChild variant="outline" size="sm" className="rounded-xl">
                          <Link href={`/profile/${user.id}`}>{t.viewProfile}</Link>
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
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
