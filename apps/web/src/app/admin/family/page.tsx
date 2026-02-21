'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type Member = { id: string; displayName: string; email: string | null; isAdmin: boolean; isSystemAdmin?: boolean };
type Invite = { id: string; email: string; token: string; expiresAt: string };

export default function AdminFamilyPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const [m, i] = await Promise.all([api.get('/family/members'), api.get('/family/invites')]);
      setMembers(m);
      setInvites(i);
    } catch (err: any) {
      setError(err.message || 'Failed to load family data');
    }
  }

  useEffect(() => { load(); }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/family/invites', { email, expiresInDays: 7 });
      setEmail('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create invite');
    }
  }

  return (
    <div>
      <div className="page-title">
        <h2>Admin / Family</h2>
        <p className="lead">Manage members and invitations for the active tenant.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <form className="card form-grid" onSubmit={invite}>
        <input placeholder="Invite email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit">Send invite</button>
      </form>

      <section className="card">
        <h3>Members</h3>
        <ul className="list">
          {members.map((m) => (
            <li key={m.id}>{m.displayName} ({m.email || 'no-email'}) {m.isSystemAdmin ? 'root' : m.isAdmin ? 'admin' : 'member'}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>Pending Invites</h3>
        <ul className="list">
          {invites.map((i) => (
            <li key={i.id}>
              {i.email} | token: <code>{i.token}</code> | expires: {new Date(i.expiresAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
