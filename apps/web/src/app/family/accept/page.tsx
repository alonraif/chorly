'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { clearCurrentTenantId, setCurrentLocale, setCurrentUserId } from '../../../lib/user';

export default function AcceptInvitePage() {
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [locale, setLocale] = useState<'he' | 'en'>('he');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    const tokenFromUrl = new URLSearchParams(window.location.search).get('token');
    if (tokenFromUrl) setToken(tokenFromUrl);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    try {
      const data = await api.post('/family/invites/accept', {
        token,
        displayName,
        email: email || undefined,
        password,
        locale,
      });
      setResult(data);
      if (data?.id) {
        setCurrentUserId(data.id);
        setCurrentLocale(locale);
        clearCurrentTenantId();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to accept invite');
    }
  }

  return (
    <div>
      <div className="page-title">
        <h2>Accept Family Invite</h2>
        <p className="lead">Join an existing family with your invite token.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <form className="card form-grid" onSubmit={onSubmit}>
        <input placeholder="Invite token" value={token} onChange={(e) => setToken(e.target.value)} required />
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <input placeholder="Email (optional override)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Create password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <select value={locale} onChange={(e) => setLocale(e.target.value as 'he' | 'en')}>
          <option value="he">Hebrew</option>
          <option value="en">English</option>
        </select>
        <button type="submit">Accept invite</button>
      </form>

      {result && (
        <div className="card">
          <p>Joined family successfully.</p>
          <p>User ID saved to session: {result.id}</p>
        </div>
      )}
    </div>
  );
}
