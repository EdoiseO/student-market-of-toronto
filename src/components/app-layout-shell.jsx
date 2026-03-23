"use client";

import { usePathname } from "next/navigation";

import { CreateListingFab } from "@/components/create-listing-fab";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppLayoutShell({ children, user }) {
  const pathname = usePathname();
  const showSidebar =
    Boolean(user) && pathname !== "/login" && pathname !== "/register";

  return (
    <TooltipProvider>
      {showSidebar ? (
        <div className="[--header-height:calc(--spacing(16))]">
          <SidebarProvider className="flex flex-col">
            <SiteHeader />
            <div className="flex flex-1">
              <AppSidebar user={user} />
              <SidebarInset>
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
