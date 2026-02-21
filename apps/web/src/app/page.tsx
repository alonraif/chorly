import Link from 'next/link';

export default function Home() {
  return (
    <div className="cards-grid">
      <section className="card">
        <div className="page-title">
          <h2>Dashboard</h2>
          <p className="lead">Manage family chores with a cleaner workflow across onboarding, daily execution, and admin controls.</p>
        </div>
      </section>

      <section className="card">
        <h3>Quick Links</h3>
        <ul className="list">
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
      </section>
    </div>
  );
}
