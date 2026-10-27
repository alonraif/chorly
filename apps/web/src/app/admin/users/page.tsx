'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { firstName, money } from '../../../lib/format';
import { useSession, type Member } from '../../../lib/session';
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
      title: `Pay ${firstName(kid.displayName)} ${money(due, currency)}?`,
      body: 'Marks the full balance as paid and resets it to zero.',
      confirmLabel: 'Mark as paid',
    });
    if (!ok) return;
    try {
      await api.post(`/users/${kid.id}/payout-reset`, {});
      toast(`${firstName(kid.displayName)}’s balance is paid`);
      loadEarnings();
    } catch (err) {
      toast(errorMessage(err, 'Could not mark as paid'), 'error');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Family</h1>
          <p className="muted">{family?.name || 'Your family'} · {members.length} {members.length === 1 ? 'member' : 'members'}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Icon name="userPlus" size={18} /> Add member
        </button>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>Kids</h2>
        </div>
        {kids.length === 0 ? (
          <button type="button" className="add-tile" onClick={() => setEditing('new')}>
            <Icon name="userPlus" size={22} />
            <span>
              <strong>Add your first kid</strong>
              <span className="small muted">They’ll sign in on their own phone to see and check off chores.</span>
            </span>
          </button>
        ) : (
          <div className="member-grid">
            {kids.map((kid) => {
              const e = earnings[kid.id];
              const due = Number(e?.dueAmount || 0);
              return (
                <article key={kid.id} className="member-card">
                  <button type="button" className="member-head" onClick={() => setEditing(kid)} aria-label={`Edit ${kid.displayName}`}>
                    <Avatar user={kid} size={48} />
                    <span className="member-id">
                      <strong>{kid.displayName}</strong>
                      <span className="small muted">{kid.email || 'No login yet'}</span>
                    </span>
                    {kid.isAway && (
                      <span className="pill pill-neutral"><Icon name="plane" size={14} /> Away</span>
                    )}
                    <Icon name="edit" size={18} className="member-edit" />
                  </button>
                  <div className="member-balance">
                    <span>
                      <span className="small muted">Balance</span>
                      <span className="balance-amount">{e ? money(e.dueAmount, e.currencyCode) : '—'}</span>
                      {e && Number(e.paidOutTotal) > 0 && (
                        <span className="small muted">{money(e.paidOutTotal, e.currencyCode)} paid so far</span>
                      )}
                    </span>
                    {due > 0 && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => markPaid(kid)}>
                        <Icon name="wallet" size={16} /> Mark paid
                      </button>
                    )}
                  </div>
                  <Link className="member-link" href={`/child?user=${kid.id}`}>
                    See {firstName(kid.displayName)}’s view <Icon name="arrowRight" size={16} />
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Parents</h2>
        </div>
        <div className="list-card">
          <ul className="rows">
            {parents.map((p) => (
              <li key={p.id}>
                <button type="button" className="row" onClick={() => setEditing(p)}>
                  <Avatar user={p} size={36} />
                  <span className="row-main">
                    <span className="row-title">
                      {p.displayName}
                      {p.id === me.id && <span className="muted"> (you)</span>}
                    </span>
                    <span className="row-sub">{p.email || 'No login'}</span>
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
        ? blankDraft
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
    if (!draft.displayName.trim()) return setError('Enter a name.');
    if (draft.password && draft.password.length < 8) return setError('Passwords need at least 8 characters.');
    if (isNew && draft.email && !draft.password) return setError('Set a password so they can sign in.');
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
        toast(`${firstName(body.displayName)} added`);
      } else if (member) {
        await api.patch(`/users/${member.id}`, body);
        toast('Saved');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  }

  const isKid = draft.role === 'child';

  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={member === 'new' ? 'Add a family member' : `Edit ${member ? firstName(member.displayName) : ''}`}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="member-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </button>
        </>
      }
    >
      <form id="member-form" className="stack-lg" onSubmit={onSubmit} noValidate>
        {isNew && (
          <Segmented
            label="Role"
            value={draft.role}
            onChange={(v) => set('role', v)}
            options={[
              { value: 'child', label: 'Kid' },
              { value: 'parent', label: 'Parent' },
            ]}
          />
        )}
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder={isKid ? 'e.g. Noa' : 'e.g. Dana'} data-autofocus />
        </label>

        <fieldset className="fieldset">
          <legend className="field-label">
            <Icon name="lock" size={16} /> Sign-in
          </legend>
          <label className="field">
            <span className="field-label-sm">Email or username</span>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder={isKid ? 'noa@family.home' : 'you@example.com'}
            />
            {isKid && <span className="field-hint">Doesn’t need to be a real inbox — it’s just what they type to sign in.</span>}
          </label>
          <label className="field">
            <span className="field-label-sm">{isNew ? 'Password' : 'New password'}</span>
            <span className="input-with-btn">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder={isNew ? 'At least 8 characters' : 'Leave blank to keep the current one'}
              />
              <button type="button" className="icon-btn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </span>
          </label>
        </fieldset>

        <div className="field">
          <span className="field-label-sm">Chore names in</span>
          <Segmented
            label="Language"
            value={draft.locale}
            onChange={(v) => set('locale', v)}
            options={[
              { value: 'he', label: 'עברית' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>

        {isKid && (
          <Switch
            checked={draft.isAway}
            onChange={(v) => set('isAway', v)}
            label="Away"
            hint="On a trip or at camp? New chores skip them until you turn this off."
          />
        )}

        {error && <p className="callout callout-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
