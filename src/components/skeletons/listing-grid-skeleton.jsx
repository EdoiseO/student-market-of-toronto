import { ListingCardSkeleton } from "./listing-card-skeleton";

export function ListingGridSkeleton({ count = 8, compact = false }) {
  return (
    <div
      aria-hidden="true"
      className={
        compact
          ? "grid min-w-0 grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-6"
          : "grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      }
    >
      {Array.from({ length: count }, (_, index) => (
        <ListingCardSkeleton key={index} compact={compact} />
      ))}
    </div>
  );
}
