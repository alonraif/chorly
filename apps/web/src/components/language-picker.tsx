'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { getLocale, t, type Locale } from '../lib/i18n';
import { setCurrentLocale } from '../lib/user';
import { Icon } from './icon';
import { errorMessage, Segmented } from './ui';

// Language names are always written in their own language.
const OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
];

// Signed-in members: saved to their profile, so it follows them to every device and their notifications.
export function LanguageRow() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function change(locale: Locale) {
    if (locale === getLocale() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.patch('/users/me', { locale });
      setCurrentLocale(locale);
    } catch (err) {
      setError(errorMessage(err, t('lang.couldNotChange')));
      setSaving(false);
    }
  }

  return (
    <div className="setting-row setting-row-wrap">
      <span className="setting-icon">
        <Icon name="globe" size={18} />
      </span>
      <span className="setting-text">
        <span className="setting-label">{t('lang.label')}</span>
        <span className="field-hint">{error || t('lang.hint')}</span>
      </span>
      <Segmented label={t('lang.label')} value={getLocale()} onChange={change} options={OPTIONS} />
    </div>
  );
}

// Signed-out screens: remembered on this device only (and used for the new family's first parent).
export function PublicLanguageSwitch() {
  return (
    <div className="public-lang">
      <Segmented label="Language / שפה" value={getLocale()} onChange={(l) => setCurrentLocale(l)} options={OPTIONS} />
    </div>
  );
}
