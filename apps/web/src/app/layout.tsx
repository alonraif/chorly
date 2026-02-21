import './globals.css';
import type { ReactNode } from 'react';
import { Assistant, Rubik } from 'next/font/google';
import { LocaleDirection } from '../components/locale-direction';
import { AppFrame } from '../components/app-frame';

export const metadata = { title: 'Chorly' };

const heading = Rubik({ subsets: ['latin', 'hebrew'], weight: ['500', '700'], variable: '--font-heading' });
const body = Assistant({ subsets: ['latin', 'hebrew'], weight: ['400', '500', '700'], variable: '--font-body' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${heading.variable} ${body.variable}`}>
      <body className="app-body">
        <LocaleDirection />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
