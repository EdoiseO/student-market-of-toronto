import { cookies } from "next/headers";

import { AdminBoundedRecordsSkeleton } from "@/components/skeletons/admin-dashboard-skeleton";
import { translations } from "@/lib/translations";

export default async function AdminListingsLoading() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;

  return (
    <AdminBoundedRecordsSkeleton
      ariaLabel={`${t.loading} ${t.adminListings}`}
      filterVariant="listings"
    />
  );
}
