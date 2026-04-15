"use client";

import Link from "next/link";

import { CardImage } from "@/components/card-image";
import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedCategoryTitle } from "@/lib/categories";

export default function HomePageContent({ listingSections }) {
  const { t, language } = useLanguage();

  return (
    <main className="min-h-screen bg-zinc-100 p-6 dark:bg-background md:p-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-950 dark:text-foreground">
              {t.buySell}
            </h1>
            <p className="mt-4 max-w-2xl text-base text-zinc-600 dark:text-muted-foreground">
              {t.homeDescription}
            </p>
          </div>
        </section>

        {listingSections.map((section) => (
          <section
            key={section.title}
            id={section.slug}
            className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <Link
                  href={section.href}
                  className="inline-flex items-center gap-2 text-2xl font-bold text-zinc-950 transition-colors hover:text-zinc-700 dark:text-foreground dark:hover:text-foreground/80"
                >
                  <span>{getTranslatedCategoryTitle(section.slug, t, language, section.title)}</span>
                  <span aria-hidden="true">➔</span>
                </Link>
                <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                  {t.categoryDescription}
                </p>
              </div>
            </div>

            {section.items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {section.items.map((item) => (
                  <CardImage
                    key={item.id}
                    badge={item.badge}
                    title={item.title}
                    price={`$${Number(item.price).toFixed(2)}`}
                    meta={item.location ?? ""}
                    imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                    imageUrl={item.listing_images?.[0]?.image_url ?? null}
                    imageAlt={item.title}
                    href={`/listings/${item.slug}`}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-muted-foreground">{t.noListings}</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
