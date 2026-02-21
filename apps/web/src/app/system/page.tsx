'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { setCurrentTenantId } from '../../lib/user';

type Tenant = { id: string; name: string; createdAt: string };

export default function SystemPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/system/tenants').then(setTenants).catch((e) => setError(e.message || String(e)));
  }, []);

  return (
    <div>
      <div className="page-title">
        <h2>System Admin</h2>
        <p className="lead">Switch active tenant context while operating as a root user.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <h3>Tenants</h3>
        <ul className="list">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <b>{tenant.name}</b> ({tenant.id})
              <button onClick={() => { setCurrentTenantId(tenant.id); window.location.reload(); }}>Use tenant context</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
