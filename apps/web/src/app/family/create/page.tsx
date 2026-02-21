'use client';

import { FormEvent, useState } from 'react';
import { api } from '../../../lib/api';
import { clearCurrentTenantId, setCurrentLocale, setCurrentUserId } from '../../../lib/user';

export default function CreateFamilyPage() {
  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'parent' | 'child'>('parent');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [locale, setLocale] = useState<'he' | 'en'>('he');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    try {
      const data = await api.post('/family/create', {
        familyName,
        displayName,
        role,
        email: email || undefined,
        password,
        locale,
      });
      setResult(data);
      if (data?.admin?.id) {
        setCurrentUserId(data.admin.id);
        setCurrentLocale(locale);
        clearCurrentTenantId();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create family');
    }
  }

  return (
    <div>
      <div className="page-title">
        <h2>Create Family</h2>
        <p className="lead">First-time onboarding: create a family and become its admin.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <form className="card form-grid" onSubmit={onSubmit}>
        <input placeholder="Family name" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
        <input placeholder="Your display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <select value={role} onChange={(e) => setRole(e.target.value as 'parent' | 'child')}>
          <option value="parent">Parent</option>
          <option value="child">Child</option>
        </select>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <select value={locale} onChange={(e) => setLocale(e.target.value as 'he' | 'en')}>
          <option value="he">Hebrew</option>
          <option value="en">English</option>
        </select>
        <button type="submit">Create family</button>
      </form>

      {result && (
        <div className="card">
          <p>Family created.</p>
          <p>Tenant ID: {result.tenant?.id}</p>
          <p>Admin User ID saved to session: {result.admin?.id}</p>
        </div>
      )}
    </div>
  );
}
