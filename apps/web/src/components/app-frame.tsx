'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';

type CurrentFamily = {
  id: string;
  name: string;
  defaultLocale: 'en' | 'he';
};

export function AppFrame({ children }: { children: ReactNode }) {
  const [familyName, setFamilyName] = useState('');

  useEffect(() => {
    api
      .get('/family/current')
      .then((family: CurrentFamily | null) => setFamilyName(family?.name || ''))
      .catch(() => setFamilyName(''));
  }, []);

  return (
    <main className="container app-shell">
      <header className="app-header">
        <div className="header">
          <Link className="site-brand" href="/">
            <h1 className="site-title">Chorly</h1>
            {familyName && <p className="site-family">{familyName}</p>}
          </Link>
        </div>
      </header>
      {children}
    </main>
  );
}
