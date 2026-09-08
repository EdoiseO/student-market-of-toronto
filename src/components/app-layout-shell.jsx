"use client";

import { usePathname } from "next/navigation";

import { CreateListingFab } from "@/components/create-listing-fab";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminNavigation } from "@/components/admin-navigation";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { NotificationProvider } from "@/components/notification-provider";
import { ModerationStandingBanner } from "@/components/moderation-standing-banner";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppLayoutShell({ children, user }) {
  const pathname = usePathname();
  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forget-password" ||
    pathname === "/reset-password" ||
    pathname === "/banned";
  const showSidebar = !isAuthPage;
  const isMessagesConversationPage =
    pathname?.startsWith("/messages/") && pathname !== "/messages";
  const isAdminPage = pathname?.startsWith("/admin") ?? false;

  return (
    <TooltipProvider>
      {showSidebar ? (
        <NotificationProvider key={user?.id ?? "guest"} userId={user?.id ?? null}>
          <div
            className={
              isMessagesConversationPage
                ? "h-svh overflow-hidden [--header-height:calc(--spacing(16))]"
                : "[--header-height:calc(--spacing(16))]"
            }
          >
            <SidebarProvider
              className={
                isMessagesConversationPage
                  ? "flex h-full flex-col overflow-hidden"
                  : "flex flex-col"
              }
            >
              {isMessagesConversationPage ? (
                <div className="hidden shrink-0 md:block">
                  <SiteHeader user={user} />
                </div>
              ) : (
                <SiteHeader user={user} />
              )}
              <div
                className={
                  isMessagesConversationPage
                    ? "flex min-h-0 flex-1 overflow-hidden"
                    : "flex flex-1"
                }
              >
                <AppSidebar user={user} />
                <SidebarInset
                  className={
                    isMessagesConversationPage
                      ? "min-h-0 min-w-0 max-w-full touch-pan-y overflow-hidden overscroll-x-none"
                      : "min-w-0 overflow-x-clip pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0"
                  }
                >
                  {isMessagesConversationPage ? null : (
                    <ModerationStandingBanner user={user} />
                  )}
                  {isAdminPage ? <AdminNavigation role={user?.role} /> : null}
                  {children}
                  {!isAdminPage && !isMessagesConversationPage ? (
                    <div className="hidden md:block">
                      <CreateListingFab user={user} />
                    </div>
                  ) : null}
                </SidebarInset>
              </div>
              {isMessagesConversationPage ? null : <MobileBottomNav user={user} />}
            </SidebarProvider>
          </div>
        </NotificationProvider>
      ) : (
        children
      )}
    </TooltipProvider>
  );
}
