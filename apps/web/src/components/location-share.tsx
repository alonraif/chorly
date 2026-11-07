'use client';

import { LOCATION_SHARE_DURATIONS } from '@chorly/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { firstName, relativeTime } from '../lib/format';
import { t, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { errorMessage, Sheet, useUi } from './ui';

type Duration = (typeof LOCATION_SHARE_DURATIONS)[number];
type ShareLink = {
  id: string;
  label: string | null;
  userIds: string[];
  expiresAt: string;
  createdBy: string;
  lastViewedAt: string | null;
  pinSet: boolean;
  locked: boolean;
};

const DEFAULT_DURATION: Duration = 480;

// Temporary links that show chosen members on a live map. The token is stored hashed,
// so the full link only exists here, right after it's made.
export function LocationShareSection() {
  const { members } = useSession();
  const { toast, confirm } = useUi();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [madeLink, setMadeLink] = useState('');

  const load = useCallback(() => {
    api.get('/family/location-shares').then(setLinks).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function revoke(link: ShareLink) {
    const ok = await confirm({ title: t('share.revokeTitle'), body: t('share.revokeBody'), confirmLabel: t('share.revoke') });
    if (!ok) return;
    try {
      await api.delete(`/family/location-shares/${link.id}`);
      load();
    } catch (err) {
      toast(errorMessage(err, t('share.couldNotRevoke')), 'error');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(madeLink);
      toast(t('share.copied'));
    } catch (err) {
      toast(errorMessage(err, t('common.somethingWrong')), 'error');
    }
  }

  async function share() {
    try {
      await navigator.share({ title: t('share.title'), text: t('share.shareText'), url: madeLink });
    } catch {
      // Closing the share sheet isn't an error.
    }
  }

  if (links === null) return null;
  const byId = new Map(members.map((m) => [m.id, m]));

  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('share.title')}</h2>
      </div>
      <div className="display-link-card">
        <p className="small muted">{t('share.hint')}</p>
        {madeLink && (
          <div className="callout callout-info">
            <p>{t('share.showOnce')}</p>
            <input className="input" dir="ltr" readOnly value={madeLink} aria-label={t('share.title')} onFocus={(e) => e.target.select()} />
            <div className="display-link-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
                <Icon name="check" size={16} /> {t('share.copy')}
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={share}>
                  {t('share.share')}
                </button>
              )}
            </div>
          </div>
        )}
        {links.length > 0 && (
          <ul className="share-links">
            {links.map((link) => {
              const people = link.userIds.flatMap((id) => byId.get(id) ?? []);
              return (
                <li key={link.id} className={`share-link ${link.locked ? 'is-locked' : ''}`}>
                  <span className="avatar-stack">
                    {people.map((p) => (
                      <Avatar key={p.id} user={p} size={26} />
                    ))}
                  </span>
                  <span className="row-main">
                    <span className="row-title">
                      <bdi>{link.label || t('share.untitled')}</bdi>
                    </span>
                    <span className="row-sub">
                      {link.locked
                        ? t('share.lockedRow')
                        : [
                            t('share.ends', { time: relativeTime(link.expiresAt) }),
                            link.pinSet ? t('share.pinSet') : t('share.notOpened'),
                            link.lastViewedAt ? t('share.viewed', { time: relativeTime(link.lastViewedAt) }) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </span>
                  {!link.locked && (
                    <button type="button" className="btn btn-ghost-danger btn-sm" onClick={() => revoke(link)}>
                      {t('share.revoke')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="display-link-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
            <Icon name="pin" size={16} /> {t('share.create')}
          </button>
        </div>
      </div>

      <CreateShareSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(token) => {
          setMadeLink(`${window.location.origin}/share/${token}`);
          setCreating(false);
          load();
        }}
      />
    </section>
  );
}

function CreateShareSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (token: string) => void }) {
  const { members: everyone } = useSession();
  const members = useMemo(() => everyone.filter((m) => m.isActive), [everyone]);
  const { toast } = useUi();
  const [userIds, setUserIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>(DEFAULT_DURATION);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Everyone is chosen to start with: a parent usually shares the whole family.
  useEffect(() => {
    if (!open) return;
    setUserIds(members.map((m) => m.id));
    setDuration(DEFAULT_DURATION);
    setLabel('');
  }, [open, members]);

  function toggle(id: string) {
    setUserIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (userIds.length === 0) {
      toast(t('share.pickSomeone'), 'error');
      return;
    }
    setSaving(true);
    try {
      const { token }: { token: string } = await api.post('/family/location-shares', {
        userIds,
        durationMinutes: duration,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      onCreated(token);
    } catch (err) {
      toast(errorMessage(err, t('share.couldNotCreate')), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('share.title')}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="share-form" className="btn btn-primary" disabled={saving || userIds.length === 0}>
            {t('share.createLink')}
          </button>
        </>
      }
    >
      <form id="share-form" className="stack-lg" onSubmit={submit} noValidate>
        <div className="field">
          <span className="field-label">{t('share.who')}</span>
          <div className="chip-row">
            {members.map((person) => {
              const on = userIds.includes(person.id);
              return (
                <button key={person.id} type="button" className={`chip chip-person ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => toggle(person.id)}>
                  <Avatar user={person} size={26} />
                  {firstName(person.displayName)}
                  {on && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <span className="field-label">{t('share.howLong')}</span>
          <div className="chip-row">
            {LOCATION_SHARE_DURATIONS.map((minutes) => (
              <button key={minutes} type="button" className={`chip ${duration === minutes ? 'is-on' : ''}`} aria-pressed={duration === minutes} onClick={() => setDuration(minutes)}>
                {t(`share.d${minutes}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">{t('share.label')}</span>
          <input className="input" maxLength={40} value={label} placeholder={t('share.labelPlaceholder')} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <p className="field-hint">{t('share.pinNote')}</p>
      </form>
    </Sheet>
  );
}
