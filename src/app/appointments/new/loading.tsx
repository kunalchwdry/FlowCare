import { Skeleton, SlotGridSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-4 py-2">
      <div className="fc-card p-5">
        <Skeleton className="h-5 w-48" />
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-2 flex-1" rounded="rounded-full" />
          ))}
        </div>
      </div>
      <div className="fc-card p-5"><SlotGridSkeleton /></div>
    </div>
  );
}
