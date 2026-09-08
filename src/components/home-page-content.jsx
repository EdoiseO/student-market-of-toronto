"use client";

import Link from "next/link";

import { CardImage } from "@/components/card-image";
import { useLanguage } from "@/context/LanguageContext";
import { getTranslatedCategoryTitle } from "@/lib/categories";

export default function HomePageContent({ listingSections }) {
  const { t, language } = useLanguage();

  return (
    <main className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 py-6 dark:bg-background md:p-8">
      <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-col gap-6 md:gap-8">
        <section className="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-zinc-200 dark:bg-card dark:ring-border md:rounded-3xl md:p-8">
          <div>
            <h1 className="max-w-3xl text-xl leading-tight font-bold tracking-tight text-zinc-950 dark:text-foreground sm:text-2xl md:text-4xl">
              {t.buySell}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-snug text-zinc-600 dark:text-muted-foreground md:mt-4 md:text-base md:leading-normal">
              {t.homeDescription}
            </p>
          </div>
        </section>

        {listingSections.map((section, sectionIndex) => (
          <section
            key={section.title}
            id={section.slug}
            className="min-w-0 rounded-3xl bg-zinc-50 p-4 shadow-sm ring-1 ring-zinc-200 dark:bg-muted/40 dark:ring-border md:p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <Link
                  href={section.href}
                  className="inline-flex min-h-11 items-center gap-2 text-xl font-bold text-zinc-950 transition-colors hover:text-zinc-700 dark:text-foreground dark:hover:text-foreground/80 md:text-2xl"
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
              <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                {section.items.map((item, itemIndex) => (
                  <div
                    key={item.id}
                    className={itemIndex >= 4 ? "hidden min-w-0 xl:block" : "min-w-0"}
                  >
                    <CardImage
                      badge={item.badge}
                      title={item.title}
                      price={`$${Number(item.price).toFixed(2)}`}
                      meta={item.location ?? ""}
                      imageUrls={(item.listing_images ?? []).map((image) => image.image_url)}
                      imageAlt={item.title}
                      imageSizes="(max-width: 767px) calc((100vw - 5rem) / 2), (max-width: 1023px) calc((100vw - 27rem) / 2), (max-width: 1279px) calc((100vw - 29rem) / 3), (max-width: 1535px) 16vw, 220px"
                      href={`/listings/${item.slug}`}
                      compact
                      prioritizeImage={sectionIndex === 0 && itemIndex < 2}
                    />
                  </div>
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
