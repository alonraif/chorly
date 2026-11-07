import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The link is a secret: keep it out of search engines and out of the Referer sent to map tiles.
export const metadata: Metadata = {
  title: 'Chorly',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  return children;
}
