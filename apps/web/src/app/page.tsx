'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
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
      setError(t('login.enterBoth'));
      return;
    }
    setLoading(true);
    try {
      const user = await api.post('/auth/login', { email: email.trim(), password });
      setCurrentUserId(user.id);
      setCurrentLocale(user.locale);
      router.push(homeFor(user));
    } catch (err: any) {
      setError(/401|invalid|credentials/i.test(err?.message || '') ? t('login.mismatch') : err?.message || t('login.couldNotSignIn'));
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <BrandMark size={44} />
        <h1>Chorly</h1>
        <p>{t('login.tagline')}</p>
      </div>

      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h2>{t('common.signIn')}</h2>

        {needsSetup && (
          <Link href="/register" className="callout callout-info setup-callout">
            <Icon name="sparkle" size={18} />
            <span>
              <strong>{t('login.newHere')}</strong> {t('login.setupFirst')}
            </span>
            <Icon name="arrowRight" size={18} />
          </Link>
        )}

        <label className="field">
          <span className="field-label-sm">{t('common.emailOrUsername')}</span>
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
          <span className="field-label-sm">{t('common.password')}</span>
          <span className="input-with-btn">
            <input
              className="input input-lg"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="icon-btn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}>
              <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </span>
        </label>

        {error && <p className="callout callout-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
          {loading ? t('login.signingIn') : t('common.signIn')}
        </button>

        <p className="small muted center">{t('login.kidsHint')}</p>
      </form>
    </div>
  );
}
