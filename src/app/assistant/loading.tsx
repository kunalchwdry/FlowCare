import { Skeleton, TextBlockSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-4 py-2">
      <div className="fc-card p-6">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-3 h-3.5 w-80" />
      </div>
      <div className="fc-card p-6"><TextBlockSkeleton lines={5} /></div>
      <div className="fc-card p-6"><TextBlockSkeleton lines={4} /></div>
    </div>
  );
}
