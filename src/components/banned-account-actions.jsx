"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";
import { createClient } from "@/utils/supabase/client";

export function BannedAccountActions() {
  const { t } = useLanguage();
  const supabase = React.useMemo(() => createClient(), []);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <Button type="button" className="rounded-xl" onClick={handleSignOut} disabled={isSigningOut}>
      {isSigningOut ? t.saving : t.signOut}
    </Button>
  );
}
