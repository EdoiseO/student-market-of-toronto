/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
} from "@/components/ui/card"

export function CardImage({
  badge,
  title = "Campus essentials bundle",
  price = "$40",
  meta = "St. George Campus",
  imageUrl,
  imageAlt = "Marketplace card",
  actionLabel = "View Listing",
  href = "#",
}) {
  return (
    <Card className="flex h-full w-full max-w-none flex-col gap-0 overflow-hidden border-zinc-200 bg-white pt-0 shadow-sm ring-1 ring-zinc-200/80 transition-transform hover:-translate-y-0.5 dark:border-zinc-800 dark:bg-zinc-900 dark:ring-zinc-800/80">
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200 dark:bg-zinc-800">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-label={imageAlt}
            className="h-full w-full bg-zinc-200 dark:bg-zinc-800"
          />
        )}
        {badge ? (
          <div className="absolute left-3 top-3">
            <Badge variant="secondary" className="bg-white/90 text-zinc-900 dark:bg-zinc-900/90 dark:text-zinc-50">
              {badge}
            </Badge>
          </div>
        ) : null}
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <CardTitle className="min-h-[3.5rem] text-lg font-semibold text-zinc-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden dark:text-zinc-50">
          {title}
        </CardTitle>
        <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{price}</p>
        <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{meta}</p>
      </CardContent>
      <CardFooter className="border-t border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/70">
        <Button className="w-full" size="sm" asChild>
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
