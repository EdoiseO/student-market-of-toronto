"use client";

import Link from "next/link";

import { CardImage } from "@/components/card-image";
import { useLanguage } from "@/context/LanguageContext";
import LanguageSwitcher from "@/components/language-switcher";
import { getTranslatedCategoryTitle } from "@/lib/categories";

export default function HomePageContent({ listingSections }) {
  const { t, language } = useLanguage();

  return (
    <main className="min-h-screen bg-zinc-100 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <section className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
                {t.studentMarket} {t.toronto}
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-950">
                {t.buySell}
              </h1>
              <p className="mt-4 max-w-2xl text-base text-zinc-600">
                {t.homeDescription}
              </p>
            </div>

            <LanguageSwitcher />
          </div>
        </section>

        {listingSections.map((section) => (
          <section
            key={section.title}
            id={section.slug}
            className="rounded-3xl bg-zinc-50 p-6 shadow-sm ring-1 ring-zinc-200"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <Link
                  href={section.href}
                  className="inline-flex items-center gap-2 text-2xl font-bold text-zinc-950 transition-colors hover:text-zinc-700"
                >
                  <span>{getTranslatedCategoryTitle(section.slug, t, language, section.title)}</span>
                  <span aria-hidden="true">➔</span>
                </Link>
                <p className="mt-1 text-sm text-zinc-500">
                  {t.categoryDescription}
                </p>
              </div>
            </div>

            {section.items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
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
              <p className="text-sm text-zinc-500">{t.noListings}</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}