import { Skeleton } from "@/components/ui/skeleton";

const WIDTH_CLASSES = {
  sm: "max-w-sm",
  md: "max-w-md",
};

export function AuthPageSkeleton({
  fieldCount = 2,
  width = "sm",
  label = "Loading account form",
}) {
  return (
    <main
      aria-busy="true"
      aria-label={label}
      className="flex min-h-svh w-full items-start justify-center overflow-y-auto bg-zinc-100 px-4 py-6 dark:bg-background sm:items-center md:p-6"
    >
      <div className={`flex w-full ${WIDTH_CLASSES[width] ?? WIDTH_CLASSES.sm} flex-col gap-6`}>
        <Skeleton className="mx-auto aspect-[1094/615] w-[58%] max-w-[208px] rounded-xl md:w-[72%] md:max-w-[272px]" />

        <section className="flex flex-col gap-4 rounded-xl bg-card py-4 ring-1 ring-foreground/10">
          <div className="space-y-2 px-4">
            <Skeleton className="mx-auto h-8 w-2/3 max-w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>

          <div className="flex flex-col gap-5 px-4">
            <Skeleton className="h-3 w-28" />
            {Array.from({ length: fieldCount }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ))}

            <div className="space-y-3">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="mx-auto h-4 w-3/4" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
