'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { nativePlugins, nativeUpdates } from '../lib/native';
import { Icon } from './icon';

type ServerVersion = { versionCode: number; versionName: string };
type UpdateState = { phase: 'idle' } | { phase: 'downloading'; percent: number | null } | { phase: 'error'; message: string };

// In a browser on an Android phone: a link to download the app. In the app (1.6+): an update
// button, shown only when the server has a newer version than the one installed.
export function AndroidAppRow() {
  const [mode, setMode] = useState<'download' | 'update' | null>(null);
  const [available, setAvailable] = useState<ServerVersion | null>(null);

  useEffect(() => {
    if (!nativePlugins()) {
      if (/android/i.test(navigator.userAgent)) setMode('download');
      return;
    }
    const updates = nativeUpdates();
    if (!updates) return;
    let cancelled = false;
    (async () => {
      try {
        const [installed, server] = await Promise.all([updates.getInfo(), api.get('/app/android/version') as Promise<ServerVersion>]);
        if (cancelled || !installed.supported || server.versionCode <= installed.versionCode) return;
        setAvailable(server);
        setMode('update');
      } catch {
        // No published version, or offline: nothing to offer.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === 'download') {
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
  if (mode === 'update' && available) return <UpdateRow version={available} />;
  return null;
}

function UpdateRow({ version }: { version: ServerVersion }) {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });

  async function update() {
    const updates = nativeUpdates();
    if (!updates || state.phase === 'downloading') return;
    setState({ phase: 'downloading', percent: null });
    const listener = await updates.addListener('progress', ({ percent }) => setState({ phase: 'downloading', percent }));
    try {
      // Resolves once Android's installer is open; the app restarts itself after installing.
      await updates.install();
      setState({ phase: 'idle' });
    } catch (e: any) {
      const message =
        e?.code === 'auth' ? t('app.updateSignedOut') : e?.code === 'current' ? t('app.updateCurrent') : t('app.updateFailed');
      setState({ phase: 'error', message });
    } finally {
      await listener.remove();
    }
  }

  const hint =
    state.phase === 'downloading'
      ? state.percent === null
        ? t('app.updateDownloading')
        : t('app.updateProgress', { percent: state.percent })
      : state.phase === 'error'
        ? state.message
        : t('app.updateHint');

  return (
    <button type="button" className="setting-row setting-button" onClick={update} disabled={state.phase === 'downloading'}>
      <span className="setting-icon">
        <Icon name="download" size={18} />
      </span>
      <span className="setting-text">
        <span className="setting-label">{t('app.update', { version: version.versionName })}</span>
        <span className="field-hint" role={state.phase === 'error' ? 'alert' : undefined} aria-live="polite">
          {hint}
        </span>
      </span>
    </button>
  );
}
