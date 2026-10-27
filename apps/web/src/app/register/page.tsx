'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { setCurrentLocale, setCurrentUserId } from '../../lib/user';
import { BrandMark } from '../../components/app-frame';
import { Icon } from '../../components/icon';

export default function RegisterPage() {
  const router = useRouter();

  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    if (!familyName.trim() || !displayName.trim() || !email.trim() || !password) {
      setError('Fill in all the fields.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for the password.');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/family/create', {
        familyName: familyName.trim(),
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      });
      if (data?.admin?.id) {
        setCurrentUserId(data.admin.id);
        setCurrentLocale(data.admin.locale || 'en');
      }
      router.push('/parent');
    } catch (err: any) {
      setError(err.message || 'Could not create the family');
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <BrandMark size={44} />
        <h1>Welcome to Chorly</h1>
        <p>Takes a minute: create your parent account now, then add the kids and a few chores.</p>
      </div>

      <form className="auth-card" onSubmit={onRegister} noValidate>
        <h2>Set up your family</h2>

        <label className="field">
          <span className="field-label-sm">Family name</span>
          <input className="input input-lg" placeholder="The Levys" value={familyName} onChange={(e) => setFamilyName(e.target.value)} data-autofocus />
        </label>

        <label className="field">
          <span className="field-label-sm">Your name</span>
          <input className="input input-lg" placeholder="Dana Levy" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>

        <label className="field">
          <span className="field-label-sm">Email</span>
          <input className="input input-lg" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="field">
          <span className="field-label-sm">Password</span>
          <span className="input-with-btn">
            <input
              className="input input-lg"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="At least 8 characters"
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
          {loading ? 'Creating…' : 'Create family'}
        </button>

        <p className="small muted center">
          Already set up? <Link href="/">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
