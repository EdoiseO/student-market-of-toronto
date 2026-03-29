"use client"

import Link from "next/link";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  SidebarMenu,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button";
import { LogInIcon } from "lucide-react";

export function NavUser({
  user
}) {
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
              <span>Sign In</span>
            </Link>
          </Button>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <div className="flex min-h-12 items-center gap-2 rounded-xl px-3 text-left text-sm">
            <Avatar className="h-9 w-9 rounded-xl">
              <AvatarFallback className="rounded-xl">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">Guest</span>
              <span className="truncate text-xs">Browse public listings</span>
            </div>
          </div>
          <SidebarMenuSub className="mt-2">
            <SidebarMenuSubItem className="text-xs text-sidebar-foreground/70">
              Sign in to create and manage listings
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
          <Avatar className="h-9 w-9 rounded-xl">
            <AvatarImage src={user?.avatar} alt={user?.name} />
            <AvatarFallback className="rounded-xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user?.name ?? "Student"}</span>
            <span className="truncate text-xs">{user?.email ?? ""}</span>
          </div>
        </div>
        <SidebarMenuSub className="mt-2">
          <SidebarMenuSubItem className="text-xs text-sidebar-foreground/70">
            {user?.school ?? "Toronto student"}
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
