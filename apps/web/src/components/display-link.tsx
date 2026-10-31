'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { Icon } from './icon';
import { errorMessage, useUi } from './ui';

// The token is stored hashed, so the full link only exists here, right after it's made.
export function DisplayLinkSection() {
  const { toast, confirm } = useUi();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/family/display').then((res: { enabled: boolean }) => setEnabled(res.enabled)).catch(() => undefined);
  }, []);

  async function create() {
    if (enabled) {
      const ok = await confirm({ title: t('display.replaceTitle'), body: t('display.replaceBody'), confirmLabel: t('display.newLink') });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { token }: { token: string } = await api.post('/family/display');
      setLink(`${window.location.origin}/display/${token}`);
      setEnabled(true);
    } catch (err) {
      toast(errorMessage(err, t('display.couldNotChange')), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    const ok = await confirm({ title: t('display.offTitle'), body: t('display.offBody'), confirmLabel: t('display.turnOff') });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete('/family/display');
      setLink('');
      setEnabled(false);
    } catch (err) {
      toast(errorMessage(err, t('display.couldNotChange')), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('display.copied'));
    } catch (err) {
      toast(errorMessage(err, t('common.somethingWrong')), 'error');
    }
  }

  if (enabled === null) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('display.title')}</h2>
        <span className={`pill ${enabled ? 'pill-success' : 'pill-neutral'}`}>{t(enabled ? 'display.statusOn' : 'display.statusOff')}</span>
      </div>
      <div className="display-link-card">
        <p className="small muted">{t('display.hint')}</p>
        {link && (
          <div className="callout callout-info">
            <p>{t('display.showOnce')}</p>
            <input className="input" dir="ltr" readOnly value={link} aria-label={t('display.title')} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              <Icon name="check" size={16} /> {t('display.copy')}
            </button>
          </div>
        )}
        <div className="display-link-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={create}>
            {t(enabled ? 'display.newLink' : 'display.turnOn')}
          </button>
          {enabled && (
            <button type="button" className="btn btn-ghost-danger btn-sm" disabled={busy} onClick={turnOff}>
              {t('display.turnOff')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
