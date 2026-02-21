import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { UserSwitcher } from '../components/user-switcher';

export const metadata = { title: 'Chorly' };

export default function RootLayout({ children }: { children: ReactNode }) {
  const dir = 'rtl';
  return (
    <html lang="he" dir={dir}>
      <body>
        <div className="container">
          <header className="header">
            <h1>Chorly</h1>
            <UserSwitcher />
          </header>
          <nav className="nav">
            <Link href="/">Home</Link>
            <Link href="/family/create">Create Family</Link>
            <Link href="/family/accept">Accept Invite</Link>
            <Link href="/today">Today</Link>
            <Link href="/week">Week</Link>
            <Link href="/parent/review">Parent Review</Link>
            <Link href="/admin/family">Admin Family</Link>
            <Link href="/admin/users">Admin Users</Link>
            <Link href="/admin/chores">Admin Chores</Link>
            <Link href="/system">System</Link>
          </nav>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
