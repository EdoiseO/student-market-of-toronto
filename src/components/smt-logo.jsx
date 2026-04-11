import Image from "next/image";

import { cn } from "@/lib/utils";

const SMT_LOGO_SRC = "/SMT_logo.png?v=20260411";

export function SMTLogo({ className, priority = false }) {
  return (
    <Image
      src={SMT_LOGO_SRC}
      alt="Student Market of Toronto"
      width={1094}
      height={615}
      priority={priority}
      unoptimized
      className={cn("h-auto w-full dark:invert", className)}
    />
  );
}
