import type { Metadata, Viewport } from 'next';
import './globals.css';
import { headers } from 'next/headers';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'FlowCare — Hospital discovery & outpatient appointments',
  description:
    'Find, compare and book outpatient appointments at hospitals near you, with transparent availability and verified-visit reviews.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3dbbb9',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const isHospital = requestHeaders.get('x-flowcare-area') === 'hospital';
  const isAuth = requestHeaders.get('x-flowcare-shell') === 'auth';

  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {/*
          * Hospital and authentication screens provide their own focused
          * chrome. They must not inherit the patient product navigation:
          * Discover, Map, Saved, Care hub, Messages and Compare are useful
          * after sign-in, but are distracting on a sign-in or recovery door.
          * Middleware marks these request areas because a root layout cannot
          * see the pathname directly.
          */}
        {isHospital || isAuth ? (
          <div id="main">{children}</div>
        ) : (
          <AppShell>
            <div id="main">{children}</div>
          </AppShell>
        )}
      </body>
    </html>
  );
}
