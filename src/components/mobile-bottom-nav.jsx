"use client";

import Link from "next/link";
import { CircleUserRound, House, LayoutGrid, MessageCircle, Plus } from "lucide-react";
import { usePathname } from "next/navigation";

import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

export function MobileBottomNav({ user }) {
  const pathname = usePathname() ?? "";
  const { language, t } = useLanguage();

  const items = [
    {
      href: "/",
      label: language === "fr" ? "Accueil" : "Home",
      icon: House,
      isActive: pathname === "/",
    },
    {
      href: "/search",
      label: language === "fr" ? "Parcourir" : "Browse",
      icon: LayoutGrid,
      isActive: pathname.startsWith("/search") || pathname.startsWith("/categories"),
    },
    {
      href: "/listings/create",
      label: language === "fr" ? "Vendre" : "Sell",
      icon: Plus,
      isActive: pathname.startsWith("/listings/create"),
      isPrimary: true,
    },
    {
      href: "/messages",
      label: t.messages,
      icon: MessageCircle,
      isActive: pathname.startsWith("/messages"),
    },
    {
      href: user ? "/dashboard" : "/login",
      label: t.account,
      icon: CircleUserRound,
      isActive: pathname.startsWith("/dashboard") || pathname.startsWith("/profile"),
    },
  ];

  return (
    <nav
      data-mobile-bottom-nav
      aria-label={language === "fr" ? "Navigation principale" : "Primary navigation"}
      className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-start justify-around border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.06)] backdrop-blur md:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={item.isActive ? "page" : undefined}
            className={cn(
              "relative flex h-16 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-medium text-muted-foreground transition-colors [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              item.isActive && "text-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-colors",
                item.isPrimary
                  ? "size-11 bg-zinc-950 text-white shadow-sm dark:bg-white dark:text-zinc-950"
                  : item.isActive && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className={item.isPrimary ? "size-6" : "size-5"} strokeWidth={2.25} />
            </span>
            <span className={cn(item.isPrimary && "font-semibold text-foreground")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
