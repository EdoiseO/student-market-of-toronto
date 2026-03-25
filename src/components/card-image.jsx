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
    <Card className="flex h-full w-full max-w-none flex-col gap-0 overflow-hidden border-zinc-200 bg-white pt-0 shadow-sm ring-1 ring-zinc-200/80 transition-transform hover:-translate-y-0.5">
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-label={imageAlt}
            className="h-full w-full bg-zinc-200"
          />
        )}
        {badge ? (
          <div className="absolute left-3 top-3">
            <Badge variant="secondary" className="bg-white/90 text-zinc-900">
              {badge}
            </Badge>
          </div>
        ) : null}
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <CardTitle className="min-h-[3.5rem] text-lg font-semibold text-zinc-950 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {title}
        </CardTitle>
        <p className="text-lg font-bold text-zinc-900">{price}</p>
        <p className="truncate text-sm text-zinc-500">{meta}</p>
      </CardContent>
      <CardFooter className="border-t border-zinc-100 bg-zinc-50/70">
        <Button className="w-full" size="sm" asChild>
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
