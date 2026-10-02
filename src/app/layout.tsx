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
  const isHospital = (await headers()).get('x-flowcare-area') === 'hospital';

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
          * The hospital portal brings its own chrome (HospitalShell) and
          * its sign-in page brings its own (AuthShell). Wrapping either in
          * the patient header gave staff a navigation they must not use —
          * Discover, Saved, Care hub — and drew a second FlowCare logo on
          * the sign-in card. Middleware marks the area because a layout
          * cannot see the pathname.
          */}
        {isHospital ? (
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
