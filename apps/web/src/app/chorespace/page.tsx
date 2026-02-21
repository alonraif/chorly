import Link from 'next/link';

export default function ChorespacePage() {
  return (
    <div className="home-shell">
      <section className="card home-hero">
        <div className="page-title">
          <h2>Family Chorespace</h2>
          <p className="lead">Choose a chorespace by role and run day-to-day chores without digging through admin screens.</p>
        </div>
        <div className="action-row">
          <Link className="button-link" href="/today">Open Today</Link>
          <Link className="button-link" href="/week">Open Week</Link>
        </div>
      </section>

      <section className="role-grid">
        <article className="card role-card">
          <h3>Child Chorespace</h3>
          <p className="lead">See assigned chores, update completion, and track earned money.</p>
          <Link className="button-link" href="/child">Open Child View</Link>
        </article>

        <article className="card role-card">
          <h3>Parent Chorespace</h3>
          <p className="lead">Create, assign, and edit chores with a weekly planning view.</p>
          <Link className="button-link" href="/parent">Open Parent View</Link>
        </article>
      </section>

      <section className="card">
        <h3>Setup and Admin</h3>
        <div className="admin-links home-links">
          <Link href="/family/create">Create Family</Link>
          <Link href="/family/accept">Accept Invite</Link>
          <Link href="/admin/family">Family Admin</Link>
          <Link href="/admin/users">User Admin</Link>
          <Link href="/admin/chores">Chore Admin</Link>
          <Link href="/parent/review">Parent Review</Link>
          <Link href="/system">System Admin</Link>
          <a href="http://localhost:4000/docs">API Docs</a>
        </div>
      </section>
    </div>
  );
}
