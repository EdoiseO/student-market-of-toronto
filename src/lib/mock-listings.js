const sectionDefinitions = [
  { slug: "electronics", title: "Electronics" },
  { slug: "books", title: "Books" },
  { slug: "other-categories", title: "Other Categories" },
];

const dashboardListingMeta = {
  "macbook-air-m1": { status: "active", messages: 14 },
  "ipad-10th-gen": { status: "bought", messages: 3 },
  "sony-wh-1000xm4": { status: "active", messages: 10 },
  "gaming-monitor": { status: "active", messages: 7 },
  "dell-xps-13": { status: "draft", messages: 0 },
  "calculus-textbook": { status: "inactive", messages: 2 },
  "biology-notes-set": { status: "favourite", messages: 5 },
  "psychology-handbook": { status: "sold", messages: 11 },
  "lab-manual": { status: "draft", messages: 0 },
  "discrete-math-notes": { status: "sold", messages: 6 },
  "desk-chair": { status: "active", messages: 8 },
  "mini-fridge": { status: "favourite", messages: 1 },
  "ti-84-calculator": { status: "bought", messages: 4 },
  "bike-lock-helmet": { status: "active", messages: 6 },
  "floor-lamp": { status: "inactive", messages: 1 },
};

export const allListings = [
  {
    slug: "macbook-air-m1",
    section: "electronics",
    badge: "Popular",
    title: "MacBook Air M1",
    price: "$760",
    meta: "Toronto Metropolitan University",
    campus: "TMU - Downtown Campus",
    mapQuery: "Toronto Metropolitan University, Toronto, Ontario",
    condition: "Used",
    description:
      "Well-kept MacBook Air M1 with 256GB storage and 8GB RAM. Battery health is strong, keyboard is clean, and it has been used mainly for note-taking, Figma, and class work. Charger is included and pickup can happen around the student learning centre.",
    seller: {
      name: "Phillip Onofua",
      school: "George Brown College",
      email: "phillip.onofua@georgebrown.ca",
    },
    createdAt: "2026-03-10",
    updatedAt: "2026-03-19",
    photos: [
      {
        label: "Front View",
        imageUrl:
          "https://images.unsplash.com/photo-1517336714739-489689fd1ca8?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Keyboard Close-up",
        imageUrl:
          "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Display Open",
        imageUrl:
          "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "ipad-10th-gen",
    section: "electronics",
    badge: "Featured",
    title: "iPad 10th Gen",
    price: "$420",
    meta: "University of Toronto",
    campus: "U of T St. George",
    mapQuery: "University of Toronto St. George Campus, Toronto, Ontario",
    condition: "New",
    description:
      "Barely used iPad with a clean screen, case, and Apple Pencil sleeve. Ideal for lecture notes, readings, and streaming between classes. Box is still available.",
    seller: {
      name: "Sarah Chen",
      school: "University of Toronto",
      email: "sarah.chen@mail.utoronto.ca",
    },
    createdAt: "2026-03-08",
    updatedAt: "2026-03-18",
    photos: [
      {
        label: "Front",
        imageUrl:
          "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "With Case",
        imageUrl:
          "https://images.unsplash.com/photo-1561154464-82e9adf32764?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "sony-wh-1000xm4",
    section: "electronics",
    badge: "Hot",
    title: "Sony WH-1000XM4",
    price: "$210",
    meta: "York University",
    campus: "York Keele Campus",
    mapQuery: "York University Keele Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Noise-cancelling headphones in great condition. Pads are clean, folding case is included, and the battery still lasts through long study sessions and commutes.",
    seller: {
      name: "Jordan Bailey",
      school: "York University",
      email: "jordan.bailey@yorku.ca",
    },
    createdAt: "2026-03-09",
    updatedAt: "2026-03-17",
    photos: [
      {
        label: "Headphones",
        imageUrl:
          "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Case",
        imageUrl:
          "https://images.unsplash.com/photo-1484704849700-f032a568e944?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "gaming-monitor",
    section: "electronics",
    badge: "New",
    title: "Gaming Monitor",
    price: "$180",
    meta: "Humber Polytechnic",
    campus: "Humber North Campus",
    mapQuery: "Humber Polytechnic North Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "24-inch monitor with a sharp display and no dead pixels. Comes with HDMI cable and adjustable stand. Good for gaming setups or dual-screen productivity.",
    seller: {
      name: "Aisha Rahman",
      school: "Humber Polytechnic",
      email: "aisha.rahman@humber.ca",
    },
    createdAt: "2026-03-11",
    updatedAt: "2026-03-20",
    photos: [
      {
        label: "Front",
        imageUrl:
          "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Desk Setup",
        imageUrl:
          "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "dell-xps-13",
    section: "electronics",
    badge: "Student Deal",
    title: "Dell XPS 13",
    price: "$690",
    meta: "OCAD University",
    campus: "OCAD University",
    mapQuery: "OCAD University, Toronto, Ontario",
    condition: "Used",
    description:
      "Compact Dell XPS 13 with bright screen and strong performance for Adobe apps, writing, and class projects. Includes charger and padded sleeve.",
    seller: {
      name: "Maya Grant",
      school: "OCAD University",
      email: "maya.grant@ocadu.ca",
    },
    createdAt: "2026-03-07",
    updatedAt: "2026-03-16",
    photos: [
      {
        label: "Laptop Open",
        imageUrl:
          "https://images.unsplash.com/photo-1511385348-a52b4a160dc2?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Angle View",
        imageUrl:
          "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "calculus-textbook",
    section: "books",
    badge: "Course Pack",
    title: "Calculus Textbook",
    price: "$45",
    meta: "University of Toronto",
    campus: "U of T St. George",
    mapQuery: "University of Toronto St. George Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Clean copy with only a few highlighted pages. Great for first-year calculus and engineering courses. Can meet near Robarts or the bookstore.",
    seller: {
      name: "Daniel Kim",
      school: "University of Toronto",
      email: "daniel.kim@mail.utoronto.ca",
    },
    createdAt: "2026-03-06",
    updatedAt: "2026-03-14",
    photos: [
      {
        label: "Cover",
        imageUrl:
          "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Inside Pages",
        imageUrl:
          "https://images.unsplash.com/photo-1491841573634-28140fc7ced7?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "biology-notes-set",
    section: "books",
    badge: "Bundle",
    title: "Biology Notes Set",
    price: "$25",
    meta: "Seneca Polytechnic",
    campus: "Seneca Newnham Campus",
    mapQuery: "Seneca Polytechnic Newnham Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Printed notes, diagrams, and practice questions from a high-grade biology course. Organized in binders and ready for exam prep.",
    seller: {
      name: "Olivia Brown",
      school: "Seneca Polytechnic",
      email: "olivia.brown@myseneca.ca",
    },
    createdAt: "2026-03-12",
    updatedAt: "2026-03-18",
    photos: [
      {
        label: "Binder Set",
        imageUrl:
          "https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Sample Notes",
        imageUrl:
          "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "psychology-handbook",
    section: "books",
    badge: "Used",
    title: "Psychology Handbook",
    price: "$30",
    meta: "York University",
    campus: "York Keele Campus",
    mapQuery: "York University Keele Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Intro psychology handbook with chapter tabs and summary sheets tucked inside. Some notes in pencil only.",
    seller: {
      name: "Noah Patel",
      school: "York University",
      email: "noah.patel@yorku.ca",
    },
    createdAt: "2026-03-05",
    updatedAt: "2026-03-15",
    photos: [
      {
        label: "Book Cover",
        imageUrl:
          "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Chapter Tabs",
        imageUrl:
          "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "lab-manual",
    section: "books",
    badge: "New",
    title: "Lab Manual",
    price: "$18",
    meta: "George Brown College",
    campus: "George Brown Casa Loma Campus",
    mapQuery: "George Brown College Casa Loma Campus, Toronto, Ontario",
    condition: "New",
    description:
      "Unused lab manual for a first-year science course. No markings, still in excellent condition, and useful if your bookstore copy sold out.",
    seller: {
      name: "Priya Singh",
      school: "George Brown College",
      email: "priya.singh@georgebrown.ca",
    },
    createdAt: "2026-03-13",
    updatedAt: "2026-03-19",
    photos: [
      {
        label: "Manual Front",
        imageUrl:
          "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Back Cover",
        imageUrl:
          "https://images.unsplash.com/photo-1511108690759-009324a90311?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "discrete-math-notes",
    section: "books",
    badge: "Course Text",
    title: "Discrete Math Notes",
    price: "$22",
    meta: "Toronto Metropolitan University",
    campus: "TMU - Downtown Campus",
    mapQuery: "Toronto Metropolitan University, Toronto, Ontario",
    condition: "Used",
    description:
      "Typed notes and solved examples for proofs, graphs, and logic. Printed cleanly and spiral-bound for easy studying.",
    seller: {
      name: "Liam Foster",
      school: "Toronto Metropolitan University",
      email: "liam.foster@torontomu.ca",
    },
    createdAt: "2026-03-04",
    updatedAt: "2026-03-13",
    photos: [
      {
        label: "Printed Set",
        imageUrl:
          "https://images.unsplash.com/photo-1456324504439-367cee3b3c32?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Example Pages",
        imageUrl:
          "https://images.unsplash.com/photo-1501504905252-473c47e087f8?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "desk-chair",
    section: "other-categories",
    badge: "Furniture",
    title: "Desk Chair",
    price: "$70",
    meta: "Scarborough pickup",
    campus: "Scarborough pickup",
    mapQuery: "University of Toronto Scarborough, Toronto, Ontario",
    condition: "Used",
    description:
      "Comfortable desk chair with adjustable height and supportive backrest. Good option for dorm rooms or home study spaces.",
    seller: {
      name: "Emma Wilson",
      school: "University of Toronto Scarborough",
      email: "emma.wilson@mail.utoronto.ca",
    },
    createdAt: "2026-03-15",
    updatedAt: "2026-03-20",
    photos: [
      {
        label: "Chair Front",
        imageUrl:
          "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Side View",
        imageUrl:
          "https://images.unsplash.com/photo-1519947486511-46149fa0a254?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "mini-fridge",
    section: "other-categories",
    badge: "Dorm",
    title: "Mini Fridge",
    price: "$95",
    meta: "North York pickup",
    campus: "North York pickup",
    mapQuery: "York University Keele Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Compact fridge that fits well in a dorm room and keeps drinks and snacks cold. Runs quietly and has a clean interior.",
    seller: {
      name: "Sophia Martinez",
      school: "York University",
      email: "sophia.martinez@yorku.ca",
    },
    createdAt: "2026-03-16",
    updatedAt: "2026-03-20",
    photos: [
      {
        label: "Mini Fridge",
        imageUrl:
          "https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Inside Shelves",
        imageUrl:
          "https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "ti-84-calculator",
    section: "other-categories",
    badge: "School",
    title: "TI-84 Calculator",
    price: "$55",
    meta: "Centennial College",
    campus: "Centennial College Progress Campus",
    mapQuery: "Centennial College Progress Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Reliable TI-84 in good condition with cover and fresh batteries. Great for math, accounting, and science courses.",
    seller: {
      name: "Ethan Lewis",
      school: "Centennial College",
      email: "ethan.lewis@centennialcollege.ca",
    },
    createdAt: "2026-03-14",
    updatedAt: "2026-03-18",
    photos: [
      {
        label: "Calculator Front",
        imageUrl:
          "https://images.unsplash.com/photo-1574607383476-f517f260d30b?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Calculator Keys",
        imageUrl:
          "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "bike-lock-helmet",
    section: "other-categories",
    badge: "Lifestyle",
    title: "Bike Lock + Helmet",
    price: "$35",
    meta: "Downtown Toronto",
    campus: "Downtown Toronto meetup",
    mapQuery: "Toronto Metropolitan University, Toronto, Ontario",
    condition: "Used",
    description:
      "Helmet and sturdy lock sold together. Good for commuting to campus and keeping your bike secure during classes.",
    seller: {
      name: "Zara Ahmed",
      school: "Toronto Metropolitan University",
      email: "zara.ahmed@torontomu.ca",
    },
    createdAt: "2026-03-12",
    updatedAt: "2026-03-17",
    photos: [
      {
        label: "Helmet and Lock",
        imageUrl:
          "https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Lock Detail",
        imageUrl:
          "https://images.unsplash.com/photo-1508973378895-108ebc7dfc49?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    slug: "floor-lamp",
    section: "other-categories",
    badge: "Apartment",
    title: "Floor Lamp",
    price: "$28",
    meta: "Etobicoke pickup",
    campus: "Etobicoke pickup",
    mapQuery: "Humber Polytechnic Lakeshore Campus, Toronto, Ontario",
    condition: "Used",
    description:
      "Slim floor lamp with warm light and a stable base. Works well beside a desk, couch, or bed in a student apartment.",
    seller: {
      name: "Marcus Hall",
      school: "Humber Polytechnic",
      email: "marcus.hall@humber.ca",
    },
    createdAt: "2026-03-10",
    updatedAt: "2026-03-15",
    photos: [
      {
        label: "Lamp On",
        imageUrl:
          "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=80",
      },
      {
        label: "Lamp Base",
        imageUrl:
          "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
];

export const listingSections = sectionDefinitions.map((section) => ({
  ...section,
  href: `/categories/${section.slug}`,
  items: [
    ...allListings
      .filter((listing) => listing.section === section.slug)
      .map((listing) => ({
        ...listing,
        href: `/listings/${listing.slug}`,
      })),
    {
      badge: "...",
      title: "...",
      price: "...",
      meta: "...",
      href: `/#${section.slug}`,
    },
  ],
}));

export function getListingBySlug(slug) {
  return allListings.find((listing) => listing.slug === slug) ?? null;
}

export function getSimilarListings(section, currentSlug, limit = 4) {
  return allListings
    .filter((listing) => listing.section === section && listing.slug !== currentSlug)
    .slice(0, limit);
}

export function getSectionBySlug(slug) {
  return sectionDefinitions.find((section) => section.slug === slug) ?? null;
}

export function getListingsBySection(section) {
  return allListings.filter((listing) => listing.section === section);
}

export function getFeaturedListingsBySection(section, limit = 4) {
  const sectionListings = allListings.filter((listing) => listing.section === section);
  const preferredBadges = [
    "Popular",
    "Featured",
    "Hot",
    "Student Deal",
    "Course Pack",
    "Bundle",
  ];

  const prioritized = sectionListings.filter((listing) =>
    preferredBadges.includes(listing.badge)
  );

  const fallback = sectionListings.filter(
    (listing) => !prioritized.some((featured) => featured.slug === listing.slug)
  );

  return [...prioritized, ...fallback].slice(0, limit);
}

export function getNewListingsBySection(section, limit = 4) {
  return [...allListings]
    .filter((listing) => listing.section === section)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export function getDashboardListings() {
  return allListings.map((listing) => ({
    ...listing,
    dashboardStatus: dashboardListingMeta[listing.slug]?.status ?? "active",
    messageCount: dashboardListingMeta[listing.slug]?.messages ?? 0,
  }));
}
