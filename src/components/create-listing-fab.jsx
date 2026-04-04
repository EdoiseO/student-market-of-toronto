"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export function CreateListingFab({ user }) {
  const { t } = useLanguage();
  const pathname = usePathname();

  const shouldShow =
    Boolean(user) &&
    pathname !== "/login" &&
    pathname !== "/register" &&
    pathname !== "/listings/create" &&
    !pathname.endsWith("/edit");

  if (!shouldShow) {
    return null;
  }

  return (
    <Link
      href="/listings/create"
      className="fixed bottom-8 right-8 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-950 text-white shadow-lg transition-transform hover:scale-[1.03] hover:bg-zinc-800"
      aria-label={t.createListingAriaLabel}
    >
      <Plus className="size-6" />
    </Link>
  );
}
