'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { setCurrentLocale, setCurrentUserId } from '../../lib/user';

export default function RegisterPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const displayName = useMemo(() => `${firstName} ${lastName}`.trim(), [firstName, lastName]);

  useEffect(() => {
    api.get('/auth/status')
      .then((status: { needsSetup: boolean }) => {
        if (!status.needsSetup) router.replace('/');
      })
      .catch(() => undefined);
  }, [router]);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!displayName || !email.trim() || !password.trim() || !familyName.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/family/create', {
        familyName,
        displayName,
        email,
        password,
      });
      if (data?.admin?.id) {
        setCurrentUserId(data.admin.id);
        setCurrentLocale(data.admin.locale || 'en');
      }
      router.push('/admin/users');
    } catch (err: any) {
      setError(err.message || 'Failed to register');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-shell">
      <form className="card auth-card" onSubmit={onRegister}>
        <div className="page-title">
          <h2>Set up your family</h2>
          <p className="lead">First-time setup: create the first parent account. You can add the kids next.</p>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="form-grid auth-grid">
          <label>
            First Name
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>

          <label>
            Last Name
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </label>
        </div>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Password
          <div className="password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <button type="button" className="ghost-button" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label>
          Confirm Password
          <div className="password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
            <button type="button" className="ghost-button" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label>
          Family Name
          <input
            placeholder="The Levy Family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Creating Family…' : 'Create Account'}
        </button>

        <p className="auth-secondary">
          Already have an account? <Link href="/">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
