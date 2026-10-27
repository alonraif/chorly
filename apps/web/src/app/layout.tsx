import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Assistant, Rubik } from 'next/font/google';
import { LocaleProvider } from '../components/locale-provider';
import { AppFrame } from '../components/app-frame';

export const metadata: Metadata = {
  title: 'Chorly',
  description: 'Family chores: kids check them off, parents approve, everyone earns.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Chorly', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#121413' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

const heading = Rubik({ subsets: ['latin', 'hebrew'], weight: ['500', '600', '700'], variable: '--font-heading' });
const body = Assistant({ subsets: ['latin', 'hebrew'], weight: ['400', '500', '600', '700'], variable: '--font-body' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${heading.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        <LocaleProvider>
          <AppFrame>{children}</AppFrame>
        </LocaleProvider>
      </body>
    </html>
  );
}
