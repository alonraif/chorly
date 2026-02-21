import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <p>Chorly multi-tenant dashboard.</p>
      <ul>
        <li><Link href="/family/create">Create a family (first sign-in)</Link></li>
        <li><Link href="/family/accept">Accept family invite</Link></li>
        <li><Link href="/admin/family">Manage family members/invites</Link></li>
        <li><Link href="/today">Today chores</Link></li>
        <li><Link href="/week">Weekly view</Link></li>
        <li><Link href="/parent/review">Parent review</Link></li>
        <li><Link href="/admin/users">Manage users</Link></li>
        <li><Link href="/admin/chores">Manage chores</Link></li>
        <li><Link href="/system">System admin tenant switch</Link></li>
        <li><a href="http://localhost:4000/docs">Swagger docs</a></li>
      </ul>
    </div>
  );
}
