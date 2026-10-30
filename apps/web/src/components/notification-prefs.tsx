'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { t, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import { Icon } from './icon';
import { errorMessage, Switch } from './ui';

type Pref = 'readyForApproval' | 'approved' | 'rejected' | 'morning' | 'dueSoon' | 'overdue' | 'parentDigest' | 'weekly';
type Prefs = Partial<Record<Pref, boolean>>;

const PARENT_ONLY: Pref[] = ['readyForApproval', 'parentDigest'];
const ORDER: Pref[] = ['readyForApproval', 'parentDigest', 'approved', 'rejected', 'morning', 'dueSoon', 'overdue', 'weekly'];

// Which notification types this member gets. Saved to their profile, so it applies on every device and to email.
export function NotificationPrefsRow() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState('');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setError('');
      try {
        const fresh = await api.get('/auth/me');
        setPrefs((fresh.notifyPrefs as Prefs) || {});
      } catch (err) {
        setError(errorMessage(err, t('common.somethingWrong')));
      }
    }
  }

  async function change(pref: Pref, value: boolean) {
    const previous = prefs;
    setPrefs({ ...prefs, [pref]: value });
    setError('');
    try {
      await api.patch('/users/me', { notifyPrefs: { [pref]: value } });
    } catch (err) {
      setPrefs(previous);
      setError(errorMessage(err, t('notifPrefs.couldNotSave')));
    }
  }

  const shown = ORDER.filter((p) => me.isAdmin || !PARENT_ONLY.includes(p));

  return (
    <>
      <button type="button" className="setting-row setting-button" aria-expanded={open} onClick={toggle}>
        <span className="setting-icon">
          <Icon name="list" size={18} />
        </span>
        <span className="setting-text">
          <span className="setting-label">{t('notifPrefs.label')}</span>
          <span className="field-hint">{error || t('notifPrefs.hint')}</span>
        </span>
        <span className={`setting-chevron${open ? ' is-open' : ''}`}>
          <Icon name="chevronDown" size={18} />
        </span>
      </button>
      {open && prefs && (
        <div className="notif-prefs">
          {shown.map((pref) => (
            <Switch
              key={pref}
              checked={prefs[pref] !== false}
              onChange={(value) => change(pref, value)}
              label={t(`notifPrefs.${pref}` as MessageKey)}
              hint={t(`notifPrefs.${pref}Hint` as MessageKey)}
            />
          ))}
        </div>
      )}
    </>
  );
}
