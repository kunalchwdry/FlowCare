import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="fc-card mt-10 p-10 text-center">
      <p className="text-lg font-extrabold">Page not found</p>
      <p className="mt-1 text-sm text-ink-600">The page you were looking for does not exist.</p>
      <Link href="/hospitals" className="fc-btn-primary mt-4">Go to hospital discovery</Link>
    </div>
  );
}
