export const CATEGORIES = [
  { slug: "electronics", title: "Electronics", value: "Electronics" },
  { slug: "books", title: "Books", value: "Books" },
  { slug: "clothing", title: "Clothing", value: "Clothing" },
  { slug: "furniture", title: "Furniture", value: "Furniture" },
  {
    slug: "school-supplies",
    title: "School Supplies",
    value: "School Supplies",
  },
  {
    slug: "sports-fitness",
    title: "Sports & Fitness",
    value: "Sports & Fitness",
  },
  {
    slug: "games-entertainment",
    title: "Games & Entertainment",
    value: "Games & Entertainment",
  },
  { slug: "housing", title: "Housing", value: "Housing" },
  { slug: "services", title: "Services", value: "Services" },
  { slug: "other", title: "Other", value: "Other" },
];

const CATEGORY_SLUG_ALIASES = {
  "other-categories": "other",
};

export const CATEGORY_OPTIONS = CATEGORIES.map((category) => category.value);

export function getTranslatedCategoryTitle(slug, t, language = "en", fallbackTitle = "") {
  const canonicalSlug = getCanonicalCategorySlug(slug);

  const translationMap = {
    electronics: t.electronics ?? "Electronics",
    books: t.books ?? "Books",
    clothing: t.clothing ?? (language === "fr" ? "Vêtements" : "Clothing"),
    furniture: t.furniture ?? "Furniture",
    "school-supplies":
      t.schoolSupplies ??
      (language === "fr" ? "Fournitures scolaires" : "School Supplies"),
    "sports-fitness":
      t.sportsAndFitness ??
      (language === "fr" ? "Sports et fitness" : "Sports & Fitness"),
    "games-entertainment":
      t.gamesAndEntertainment ??
      (language === "fr" ? "Jeux et divertissement" : "Games & Entertainment"),
    housing: t.housing ?? "Housing",
    services: t.services ?? "Services",
    other: t.other ?? "Other",
  };

  return translationMap[canonicalSlug] ?? fallbackTitle;
}

export function getTranslatedCategoryValue(value, t, language = "en") {
  const category = CATEGORIES.find(
    (currentCategory) =>
      currentCategory.value === value ||
      currentCategory.title === value ||
      currentCategory.slug === getCanonicalCategorySlug(value)
  );

  if (!category) {
    return value ?? "";
  }

  return getTranslatedCategoryTitle(category.slug, t, language, category.title);
}

export function getCanonicalCategorySlug(slug) {
  return CATEGORY_SLUG_ALIASES[slug] ?? slug;
}

export function getCategoryBySlug(slug) {
  const canonicalSlug = getCanonicalCategorySlug(slug);
  return CATEGORIES.find((category) => category.slug === canonicalSlug);
}

export function getCategoryValuesBySlug(slug) {
  const category = getCategoryBySlug(slug);

  if (!category) {
    return [];
  }

  if (category.slug === "other") {
    return ["Other", "Other Categories"];
  }

  return [category.value];
}

export function normalizeCategoryValue(value) {
  if (value === "Other Categories") {
    return "Other";
  }

  return value ?? "";
}
