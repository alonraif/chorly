'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { setCurrentLocale, setCurrentUserId } from '../lib/user';
import { BrandMark } from '../components/app-frame';
import { Icon } from '../components/icon';

function homeFor(user: { role: string }) {
  return user.role === 'child' ? '/child' : '/parent';
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    api.get('/auth/me')
      .then((user) => {
        setCurrentUserId(user.id);
        setCurrentLocale(user.locale);
        router.replace(homeFor(user));
      })
      .catch(() => {
        api.get('/auth/status').then((s) => setNeedsSetup(!!s.needsSetup)).catch(() => undefined);
      });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const user = await api.post('/auth/login', { email: email.trim(), password });
      setCurrentUserId(user.id);
      setCurrentLocale(user.locale);
      router.push(homeFor(user));
    } catch (err: any) {
      setError(/401|invalid|credentials/i.test(err?.message || '') ? 'That email and password don’t match.' : err?.message || 'Could not sign in');
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <BrandMark size={44} />
        <h1>Chorly</h1>
        <p>Chores, done together. Kids check them off, parents approve, everyone sees the week.</p>
      </div>

      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h2>Sign in</h2>

        {needsSetup && (
          <Link href="/register" className="callout callout-info setup-callout">
            <Icon name="sparkle" size={18} />
            <span>
              <strong>New here?</strong> Set up your family first.
            </span>
            <Icon name="arrowRight" size={18} />
          </Link>
        )}

        <label className="field">
          <span className="field-label-sm">Email or username</span>
          <input
            className="input input-lg"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-autofocus
          />
        </label>

        <label className="field">
          <span className="field-label-sm">Password</span>
          <span className="input-with-btn">
            <input
              className="input input-lg"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="icon-btn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </span>
        </label>

        {error && <p className="callout callout-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="small muted center">Kids: ask a parent for your login.</p>
      </form>
    </div>
  );
}
