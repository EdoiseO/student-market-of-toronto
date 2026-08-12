"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/utils/supabase/client";

export function BannedAccountActions() {
  const router = useRouter();
  const { t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button type="button" className="rounded-xl" onClick={handleSignOut} disabled={isSigningOut}>
      {isSigningOut ? t.saving : t.signOut}
    </Button>
  );
}
