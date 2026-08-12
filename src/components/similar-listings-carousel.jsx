"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CardImage } from "@/components/card-image";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";

export function SimilarListingsCarousel({ items }) {
  const { t, language } = useLanguage();
  const scrollerRef = React.useRef(null);
  const [canScrollBack, setCanScrollBack] = React.useState(false);
  const [canScrollForward, setCanScrollForward] = React.useState(items.length > 1);

  const updateScrollState = React.useCallback(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    setCanScrollBack(scroller.scrollLeft > 4);
    setCanScrollForward(scroller.scrollLeft < maxScrollLeft - 4);
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return undefined;
    }

    updateScrollState();
    scroller.addEventListener("scroll", updateScrollState, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [items.length, updateScrollState]);

  function scrollListings(direction) {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    scroller.scrollBy({
      left: direction * Math.max(176, scroller.clientWidth * 0.8),
      behavior: "smooth",
    });
  }

  const previousLabel =
    language === "fr" ? "Annonces similaires précédentes" : "Previous similar listings";
  const nextLabel =
    language === "fr" ? "Annonces similaires suivantes" : "Next similar listings";

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="similar-listings-title" className="text-2xl font-bold text-zinc-950 dark:text-foreground">
            {t.similarListings}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
            {t.similarListingsDesc}
          </p>
        </div>

        {items.length > 1 ? (
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label={previousLabel}
              disabled={!canScrollBack}
              onClick={() => scrollListings(-1)}
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label={nextLabel}
              disabled={!canScrollForward}
              onClick={() => scrollListings(1)}
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div
          ref={scrollerRef}
          role="list"
          aria-labelledby="similar-listings-title"
          className="-mx-1 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-1 pb-3 scroll-smooth overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <div
              key={item.slug}
              role="listitem"
              className="w-[calc((100%_-_0.75rem)/2)] max-w-48 min-w-0 flex-none snap-start self-start sm:w-44 md:w-48 lg:w-52 lg:max-w-52"
            >
              <CardImage
                badge={item.badge}
                title={item.title}
                price={item.price}
                meta={item.meta}
                imageUrls={item.imageUrls}
                href={`/listings/${item.slug}`}
                imageAlt={item.title}
                imageSizes="(max-width: 429px) calc((100vw - 3.75rem) / 2), (max-width: 639px) 192px, (max-width: 767px) 176px, (max-width: 1023px) 192px, 208px"
                compact
                rail
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-muted-foreground">{t.noListings}</p>
      )}
    </>
  );
}
