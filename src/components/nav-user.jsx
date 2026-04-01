"use client";

import Link from "next/link";

import { ProfileAvatar } from "@/components/profile-avatar";
import {
  SidebarMenu,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { LogInIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export function NavUser({ user }) {
  const { t } = useLanguage();

  const initials = user?.name
    ?.split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SM";

  if (!user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <Button asChild variant="outline" className="mb-3 w-full justify-start rounded-xl">
            <Link href="/login">
              <LogInIcon />
              <span>{t.signIn}</span>
            </Link>
          </Button>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <div className="flex min-h-12 items-center gap-2 rounded-xl px-3 text-left text-sm">
            <ProfileAvatar
              className="h-9 w-9 rounded-xl"
              fallbackClassName="rounded-xl"
              initialsOverride={initials}
            />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{t.guest}</span>
              <span className="truncate text-xs">{t.browsePublicListings}</span>
            </div>
          </div>
          <SidebarMenuSub className="mt-2">
            <SidebarMenuSubItem className="text-xs text-sidebar-foreground/70">
              {t.signInToCreate}
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex min-h-12 items-center gap-2 rounded-xl px-3 text-left text-sm">
          <ProfileAvatar
            userId={user?.id}
            email={user?.email}
            name={user?.name}
            avatarPresetId={user?.avatarPresetId}
            className="h-9 w-9 rounded-xl"
            fallbackClassName="rounded-xl"
          />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user?.name ?? t.student}</span>
            <span className="truncate text-xs">{user?.email ?? ""}</span>
          </div>
        </div>
        <SidebarMenuSub className="mt-2">
          <SidebarMenuSubItem className="text-xs text-sidebar-foreground/70">
            {user?.school ?? t.torontoStudent}
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
