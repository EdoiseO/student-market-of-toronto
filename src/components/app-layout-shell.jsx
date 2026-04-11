"use client";

import { usePathname } from "next/navigation";

import { CreateListingFab } from "@/components/create-listing-fab";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppLayoutShell({ children, user }) {
  const pathname = usePathname();
  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forget-password" ||
    pathname === "/reset-password";
  const showSidebar = !isAuthPage;
  const isMessagesConversationPage =
    pathname?.startsWith("/messages/") && pathname !== "/messages";

  return (
    <TooltipProvider>
      {showSidebar ? (
        <div
          className={
            isMessagesConversationPage
              ? "h-svh overflow-hidden [--header-height:57px]"
              : "[--header-height:57px]"
          }
        >
          <SidebarProvider
            className={
              isMessagesConversationPage
                ? "flex h-full flex-col overflow-hidden"
                : "flex flex-col"
            }
          >
            <SiteHeader user={user} />
            <div
              className={
                isMessagesConversationPage
                  ? "flex min-h-0 flex-1 overflow-hidden"
                  : "flex flex-1"
              }
            >
              <AppSidebar user={user} />
              <SidebarInset
                className={isMessagesConversationPage ? "min-h-0 overflow-hidden" : undefined}
              >
                {children}
                <CreateListingFab user={user} />
              </SidebarInset>
            </div>
          </SidebarProvider>
        </div>
      ) : (
        children
      )}
    </TooltipProvider>
  );
}
