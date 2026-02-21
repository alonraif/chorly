'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { clearCurrentTenantId, setCurrentLocale, setCurrentUserId } from '../lib/user';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const user = await api.post('/auth/login', { email, password });
      setCurrentUserId(user.id);
      setCurrentLocale(user.locale);
      clearCurrentTenantId();
      router.push('/chorespace');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div className="page-title">
          <h1>Welcome to Chorly</h1>
          <h2>Login</h2>
          <p className="lead">Sign in to your family chorespace.</p>
        </div>

        {error && <p className="error">{error}</p>}

        <label>
          Email
          <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Password
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={loading}>{loading ? 'Logging in…' : 'Login'}</button>

        <p className="auth-secondary">
          First time here? <Link href="/register">Register</Link>
        </p>
      </form>
    </section>
  );
}
