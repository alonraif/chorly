'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type User = {
  id: string;
  email: string | null;
  displayName: string;
  locale: 'en' | 'he';
  isAdmin: boolean;
  isAway: boolean;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [locale, setLocale] = useState<'en' | 'he'>('he');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAway, setIsAway] = useState(false);

  const load = () => api.get('/users').then(setUsers).catch((e) => setError(String(e.message || e)));

  useEffect(() => { load(); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', { displayName, email: email || undefined, locale, isAdmin, isAway });
      setDisplayName('');
      setEmail('');
      setLocale('he');
      setIsAdmin(false);
      setIsAway(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    }
  }

  return (
    <div>
      <h2>Admin / Users</h2>
      {error && <p className="error">{error}</p>}

      <form onSubmit={onSubmit} className="card form-grid">
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={locale} onChange={(e) => setLocale(e.target.value as 'en' | 'he')}>
          <option value="he">Hebrew</option>
          <option value="en">English</option>
        </select>
        <label><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Admin</label>
        <label><input type="checkbox" checked={isAway} onChange={(e) => setIsAway(e.target.checked)} /> Away</label>
        <button type="submit">Create user</button>
      </form>

      <table className="table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Locale</th><th>Admin</th><th>Away</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.displayName}</td>
              <td>{user.email || '-'}</td>
              <td>{user.locale}</td>
              <td>{user.isAdmin ? 'Yes' : 'No'}</td>
              <td>{user.isAway ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
