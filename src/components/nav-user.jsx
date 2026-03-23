"use client"

import dynamic from "next/dynamic";

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
  SidebarMenuButton,
} from "@/components/ui/sidebar"

const SignOutButton = dynamic(
  () =>
    import("@/components/sign-out-button").then(
      (module) => module.SignOutButton
    ),
  { ssr: false }
);

export function NavUser({
  user
}) {
  const initials = user?.name
    ?.split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SM";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SignOutButton />
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="min-h-12 rounded-xl px-3">
          <Avatar className="h-9 w-9 rounded-xl">
            <AvatarImage src={user?.avatar} alt={user?.name} />
            <AvatarFallback className="rounded-xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user?.name ?? "Student"}</span>
            <span className="truncate text-xs">{user?.email ?? ""}</span>
          </div>
        </SidebarMenuButton>
        <SidebarMenuSub className="mt-2">
          <SidebarMenuSubItem className="text-xs text-sidebar-foreground/70">
            {user?.school ?? "Toronto student"}
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
