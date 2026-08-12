import Image from "next/image";

import { cn } from "@/lib/utils";

const SMT_LOGO_SRC = "/SMT_logo.png";

export function SMTLogo({ className, priority = false }) {
  return (
    <Image
      src={SMT_LOGO_SRC}
      alt="Student Market of Toronto"
      width={1094}
      height={615}
      sizes="(max-width: 767px) 128px, 176px"
      priority={priority}
      className={cn("h-auto w-full dark:invert", className)}
    />
  );
}
