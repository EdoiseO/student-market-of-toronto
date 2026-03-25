"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";

export function FavouriteButton({ listingId, initialIsFavourited = false }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [isFavourited, setIsFavourited] = React.useState(initialIsFavourited);
  const [loading, setLoading] = React.useState(false);

  async function handleToggleFavourite() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      router.push("/login");
      return;
    }

    let error = null;

    if (isFavourited) {
      const { error: deleteError } = await supabase
        .from("listing_favourites")
        .delete()
        .eq("listing_id", listingId)
        .eq("user_id", user.id);

      error = deleteError;
    } else {
      const { error: insertError } = await supabase
        .from("listing_favourites")
        .insert({
          listing_id: listingId,
          user_id: user.id,
        });

      error = insertError;
    }

    if (!error) {
      setIsFavourited((currentValue) => !currentValue);
      router.refresh();
    }

    setLoading(false);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={handleToggleFavourite}
      disabled={loading}
      aria-label={isFavourited ? "Remove from favourites" : "Add to favourites"}
      className={cn(
        "size-11 rounded-full border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
        isFavourited &&
          "border-rose-300 bg-rose-50 text-rose-500 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60",
        loading && "cursor-not-allowed opacity-50",
      )}
    >
      <Heart className="size-5" fill={isFavourited ? "currentColor" : "none"} />
    </Button>
  );
}
