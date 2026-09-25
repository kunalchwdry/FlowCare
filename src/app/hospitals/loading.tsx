import { Skeleton } from '@/components/Skeleton';
import { HospitalListSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-4 py-2">
      <div className="fc-card p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-11 w-full" rounded="rounded-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24" rounded="rounded-full" />
          ))}
        </div>
      </div>
      <HospitalListSkeleton count={6} />
    </div>
  );
}
