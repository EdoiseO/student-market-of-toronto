"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-zinc-300 bg-input shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary/70 data-[state=checked]:bg-primary data-[state=unchecked]:border-zinc-300 data-[state=unchecked]:bg-zinc-200 dark:data-[state=checked]:border-primary/80 dark:data-[state=checked]:bg-primary dark:data-[state=unchecked]:border-zinc-500 dark:data-[state=unchecked]:bg-zinc-600",
        className
      )}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-white ring-0 shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 dark:bg-zinc-50"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch }
