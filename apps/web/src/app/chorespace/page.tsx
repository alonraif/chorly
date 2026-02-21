import Link from 'next/link';

export default function ChorespacePage() {
  return (
    <div className="home-shell">
      <section className="card home-hero">
        <div className="page-title">
          <h2>Family Chorespace</h2>
          <p className="lead">Choose a chorespace by role and run day-to-day chores.</p>
        </div>
        <div className="action-row">
          <Link className="button-link" href="/admin/chores#new-chore">Create and assign chore</Link>
          <Link className="button-link" href="/admin/chores#favorites">Assign chore from favorites</Link>
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

    </div>
  );
}
