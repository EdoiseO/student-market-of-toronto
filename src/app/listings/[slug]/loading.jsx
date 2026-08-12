import { ListingDetailSkeleton } from "@/components/skeletons/listing-detail-skeleton";

export default function ListingDetailLoading() {
  return (
    <main aria-busy="true" aria-label="Loading listing" className="min-h-screen min-w-0 overflow-x-clip bg-zinc-100 px-4 pt-4 pb-28 dark:bg-background md:p-8">
      <div className="mx-auto w-full max-w-[1440px]">
        <ListingDetailSkeleton />
      </div>
    </main>
  );
}
