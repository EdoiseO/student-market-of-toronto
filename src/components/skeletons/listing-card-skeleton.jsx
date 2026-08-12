import { Skeleton } from "@/components/ui/skeleton";

export function ListingCardSkeleton({ compact = false }) {
  return (
    <div
      aria-hidden="true"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <Skeleton
        className={
          compact
            ? "h-[108px] w-full rounded-none min-[430px]:h-[116px] md:h-[136px] lg:h-[148px]"
            : "h-[156px] w-full rounded-none min-[430px]:h-[168px] md:h-[200px] lg:h-[220px]"
        }
      />

      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className={compact ? "mt-1 h-5 w-1/3" : "mt-1 h-6 w-1/3"} />
        <div className="mt-1 flex justify-between gap-3">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-3 w-1/5" />
        </div>
      </div>
    </div>
  );
}
