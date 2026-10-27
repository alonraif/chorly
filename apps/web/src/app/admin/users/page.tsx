'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { firstName, money } from '../../../lib/format';
import { getLocale, t, tn } from '../../../lib/i18n';
import { useSession, type Member } from '../../../lib/session';
import { setCurrentLocale } from '../../../lib/user';
import type { Earnings } from '../../../lib/types';
import { Avatar } from '../../../components/avatar';
import { Icon } from '../../../components/icon';
import { errorMessage, Segmented, Sheet, Switch, useUi } from '../../../components/ui';

type MemberDraft = {
  displayName: string;
  email: string;
  password: string;
  role: 'parent' | 'child';
  locale: 'en' | 'he';
  isAway: boolean;
};

const blankDraft: MemberDraft = { displayName: '', email: '', password: '', role: 'child', locale: 'he', isAway: false };

export default function FamilyPage() {
  const { me, members, kids, family, currency, refreshMembers } = useSession();
  const { toast, confirm } = useUi();
  const [earnings, setEarnings] = useState<Record<string, Earnings>>({});
  const [editing, setEditing] = useState<Member | 'new' | null>(null);

  const parents = members.filter((m) => m.role === 'parent');

  const loadEarnings = useCallback(async () => {
    const entries = await Promise.all(
      kids.map((k) => api.get(`/users/${k.id}/earnings`).then((e: Earnings) => [k.id, e] as const).catch(() => null)),
    );
    setEarnings(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, Earnings]>));
  }, [kids]);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  async function markPaid(kid: Member) {
    const due = earnings[kid.id]?.dueAmount;
    const ok = await confirm({
      title: t('common.payConfirmTitle', { name: firstName(kid.displayName), amount: money(due, currency) }),
      body: t('common.payConfirmBody'),
      confirmLabel: t('common.markAsPaid'),
    });
    if (!ok) return;
    try {
      await api.post(`/users/${kid.id}/payout-reset`, {});
      toast(t('family.balancePaid', { name: firstName(kid.displayName) }));
      loadEarnings();
    } catch (err) {
      toast(errorMessage(err, t('common.couldNotMarkPaid')), 'error');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('family.title')}</h1>
          <p className="muted">
            {family?.name || t('family.yourFamily')} · {tn('family.members', members.length)}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Icon name="userPlus" size={18} /> {t('family.addMember')}
        </button>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>{t('family.kids')}</h2>
        </div>
        {kids.length === 0 ? (
          <button type="button" className="add-tile" onClick={() => setEditing('new')}>
            <Icon name="userPlus" size={22} />
            <span>
              <strong>{t('family.addFirstKid')}</strong>
              <span className="small muted">{t('family.addFirstKidHint')}</span>
            </span>
          </button>
        ) : (
          <div className="member-grid">
            {kids.map((kid) => {
              const e = earnings[kid.id];
              const due = Number(e?.dueAmount || 0);
              return (
                <article key={kid.id} className="member-card">
                  <button type="button" className="member-head" onClick={() => setEditing(kid)} aria-label={t('family.edit', { name: kid.displayName })}>
                    <Avatar user={kid} size={48} />
                    <span className="member-id">
                      <strong>{kid.displayName}</strong>
                      <span className="small muted">{kid.email || t('family.noLoginYet')}</span>
                    </span>
                    {kid.isAway && (
                      <span className="pill pill-neutral"><Icon name="plane" size={14} /> {t('common.away')}</span>
                    )}
                    <Icon name="edit" size={18} className="member-edit" />
                  </button>
                  <div className="member-balance">
                    <span>
                      <span className="small muted">{t('family.balance')}</span>
                      <span className="balance-amount">{e ? money(e.dueAmount, e.currencyCode) : '—'}</span>
                      {e && Number(e.paidOutTotal) > 0 && (
                        <span className="small muted">{t('family.paidSoFar', { amount: money(e.paidOutTotal, e.currencyCode) })}</span>
                      )}
                    </span>
                    {due > 0 && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => markPaid(kid)}>
                        <Icon name="wallet" size={16} /> {t('family.markPaid')}
                      </button>
                    )}
                  </div>
                  <Link className="member-link" href={`/child?user=${kid.id}`}>
                    {t('family.seeView', { name: firstName(kid.displayName) })} <Icon name="arrowRight" size={16} />
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('family.parents')}</h2>
        </div>
        <div className="list-card">
          <ul className="rows">
            {parents.map((p) => (
              <li key={p.id}>
                <button type="button" className="row" onClick={() => setEditing(p)}>
                  <Avatar user={p} size={36} />
                  <span className="row-main">
                    <span className="row-title">
                      <bdi>{p.displayName}</bdi>
                      {p.id === me.id && <span className="muted"> {t('family.you')}</span>}
                    </span>
                    <span className="row-sub">{p.email || t('family.noLogin')}</span>
                  </span>
                  <Icon name="chevronRight" size={18} className="row-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MemberSheet
        member={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          await refreshMembers();
          loadEarnings();
        }}
      />
    </div>
  );
}

function MemberSheet({ member, onClose, onSaved }: { member: Member | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useSession();
  const { toast } = useUi();
  const isNew = member === 'new';
  const [draft, setDraft] = useState<MemberDraft>(blankDraft);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!member) return;
    setError('');
    setShowPassword(false);
    setDraft(
      member === 'new'
        ? { ...blankDraft, locale: getLocale() }
        : {
            displayName: member.displayName,
            email: member.email || '',
            password: '',
            role: member.role,
            locale: member.locale,
            isAway: member.isAway,
          },
    );
  }, [member]);

  const set = <K extends keyof MemberDraft>(key: K, value: MemberDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!draft.displayName.trim()) return setError(t('family.enterName'));
    if (draft.password && draft.password.length < 8) return setError(t('family.passwordShort'));
    if (isNew && draft.email && !draft.password) return setError(t('family.needPassword'));
    const body = {
      displayName: draft.displayName.trim(),
      email: draft.email.trim() || undefined,
      password: draft.password || undefined,
      role: draft.role,
      locale: draft.locale,
      isAway: draft.isAway,
    };
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/users', body);
        toast(t('family.added', { name: firstName(body.displayName) }));
      } else if (member) {
        await api.patch(`/users/${member.id}`, body);
        toast(t('family.saved'));
        // Editing yourself here changes your own interface language too.
        if (member.id === me.id) setCurrentLocale(body.locale);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('family.couldNotSave')));
    } finally {
      setSaving(false);
    }
  }

  const isKid = draft.role === 'child';

  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={member === 'new' ? t('family.addTitle') : t('family.edit', { name: member ? firstName(member.displayName) : '' })}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" form="member-form" className="btn btn-primary" disabled={saving}>
            {saving ? t('common.saving') : isNew ? t('common.add') : t('common.save')}
          </button>
        </>
      }
    >
      <form id="member-form" className="stack-lg" onSubmit={onSubmit} noValidate>
        {isNew && (
          <Segmented
            label={t('family.role')}
            value={draft.role}
            onChange={(v) => set('role', v)}
            options={[
              { value: 'child', label: t('common.kid') },
              { value: 'parent', label: t('common.parent') },
            ]}
          />
        )}
        <label className="field">
          <span className="field-label">{t('family.name')}</span>
          <input className="input" value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder={isKid ? t('family.kidPlaceholder') : t('family.parentPlaceholder')} data-autofocus />
        </label>

        <fieldset className="fieldset">
          <legend className="field-label">
            <Icon name="lock" size={16} /> {t('family.signIn')}
          </legend>
          <label className="field">
            <span className="field-label-sm">{t('common.emailOrUsername')}</span>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder={isKid ? 'noa@family.home' : 'you@example.com'}
            />
            {isKid && <span className="field-hint">{t('family.emailHint')}</span>}
          </label>
          <label className="field">
            <span className="field-label-sm">{isNew ? t('common.password') : t('family.newPassword')}</span>
            <span className="input-with-btn">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder={isNew ? t('common.atLeast8') : t('family.keepPassword')}
              />
              <button type="button" className="icon-btn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}>
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </span>
          </label>
        </fieldset>

        <div className="field">
          <span className="field-label-sm">{t('lang.label')}</span>
          <Segmented
            label={t('lang.label')}
            value={draft.locale}
            onChange={(v) => set('locale', v)}
            options={[
              { value: 'he', label: 'עברית' },
              { value: 'en', label: 'English' },
            ]}
          />
          <span className="field-hint">{t('lang.hint')}</span>
        </div>

        {isKid && (
          <Switch
            checked={draft.isAway}
            onChange={(v) => set('isAway', v)}
            label={t('common.away')}
            hint={t('family.awayHint')}
          />
        )}

        {error && <p className="callout callout-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
