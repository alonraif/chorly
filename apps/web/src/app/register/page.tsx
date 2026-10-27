'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { getLocale, t } from '../../lib/i18n';
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
      setError(t('register.fillAll'));
      return;
    }
    if (password.length < 8) {
      setError(t('register.shortPassword'));
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/family/create', {
        familyName: familyName.trim(),
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        locale: getLocale(),
      });
      if (data?.admin?.id) {
        setCurrentUserId(data.admin.id);
        setCurrentLocale(data.admin.locale || getLocale());
      }
      router.push('/parent');
    } catch (err: any) {
      setError(err.message || t('register.couldNotCreate'));
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <BrandMark size={44} />
        <h1>{t('register.welcome')}</h1>
        <p>{t('register.intro')}</p>
      </div>

      <form className="auth-card" onSubmit={onRegister} noValidate>
        <h2>{t('register.title')}</h2>

        <label className="field">
          <span className="field-label-sm">{t('register.familyName')}</span>
          <input className="input input-lg" placeholder={t('register.familyPlaceholder')} value={familyName} onChange={(e) => setFamilyName(e.target.value)} data-autofocus />
        </label>

        <label className="field">
          <span className="field-label-sm">{t('register.yourName')}</span>
          <input className="input input-lg" placeholder={t('register.namePlaceholder')} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>

        <label className="field">
          <span className="field-label-sm">{t('common.email')}</span>
          <input className="input input-lg" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="field">
          <span className="field-label-sm">{t('common.password')}</span>
          <span className="input-with-btn">
            <input
              className="input input-lg"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={t('common.atLeast8')}
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
          {loading ? t('register.creating') : t('register.create')}
        </button>

        <p className="small muted center">
          {t('register.alreadySetUp')} <Link href="/">{t('common.signIn')}</Link>
        </p>
      </form>
    </div>
  );
}
