'use client';

import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { nativePlugins } from '../lib/native';
import { Icon } from './icon';

// Only offered in a browser on an Android phone, not to people already in the app.
export function AndroidAppRow() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(/android/i.test(navigator.userAgent) && !nativePlugins());
  }, []);

  if (!show) return null;
  return (
    <a className="setting-row setting-button" href="/api/app/android" download="chorly.apk">
      <span className="setting-icon">
        <Icon name="download" size={18} />
      </span>
      <span className="setting-text">
        <span className="setting-label">{t('app.android')}</span>
        <span className="field-hint">{t('app.androidHint')}</span>
      </span>
    </a>
  );
}
