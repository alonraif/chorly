'use client';

import type { ReactNode } from 'react';

export function AppFrame({ children }: { children: ReactNode }) {
  return <main className="container">{children}</main>;
}
