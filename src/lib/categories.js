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
