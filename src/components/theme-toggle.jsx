"use client";

import * as React from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLanguage();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className="size-10 rounded-xl bg-background/80 backdrop-blur-sm"
      onClick={() => setTheme(isDarkMode ? "light" : "dark")}
      aria-label={isDarkMode ? t.switchToLightMode : t.switchToDarkMode}
      title={isDarkMode ? t.switchToLightMode : t.switchToDarkMode}
    >
      {isDarkMode ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
}
