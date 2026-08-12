import { Skeleton } from "@/components/ui/skeleton";

function BubbleSkeleton({ side = "left" }) {
  const isRight = side === "right";

  return (
    <div className={`flex items-end gap-2 ${isRight ? "flex-row-reverse" : ""}`}>
      {!isRight ? <Skeleton className="size-7 shrink-0 rounded-full" /> : null}
      <Skeleton
        className={`h-10 max-w-[70%] rounded-2xl ${
          isRight ? "w-36 rounded-br-none" : "w-48 rounded-bl-none"
        }`}
      />
    </div>
  );
}

export function MessageThreadSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 p-4">
      <BubbleSkeleton />
      <BubbleSkeleton side="right" />
      <BubbleSkeleton />
      <BubbleSkeleton />
      <BubbleSkeleton side="right" />
      <BubbleSkeleton side="right" />
      <BubbleSkeleton />
    </div>
  );
}
