import './globals.css';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Assistant, Rubik } from 'next/font/google';
import { UserSwitcher } from '../components/user-switcher';
import { LocaleDirection } from '../components/locale-direction';

export const metadata = { title: 'Chorly' };

const heading = Rubik({ subsets: ['latin', 'hebrew'], weight: ['500', '700'], variable: '--font-heading' });
const body = Assistant({ subsets: ['latin', 'hebrew'], weight: ['400', '500', '700'], variable: '--font-body' });

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/family/create', label: 'Create Family' },
  { href: '/family/accept', label: 'Accept Invite' },
  { href: '/today', label: 'Today' },
  { href: '/week', label: 'Week' },
  { href: '/parent/review', label: 'Parent Review' },
  { href: '/admin/family', label: 'Admin Family' },
  { href: '/admin/users', label: 'Admin Users' },
  { href: '/admin/chores', label: 'Admin Chores' },
  { href: '/system', label: 'System' },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${heading.variable} ${body.variable}`}>
      <body className="app-body">
        <LocaleDirection />
        <div className="container app-shell">
          <header className="header app-header">
            <div>
              <p className="eyebrow">Family Chore Hub</p>
              <h1 className="site-title">Chorly</h1>
            </div>
            <UserSwitcher />
          </header>
          <nav className="nav">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
