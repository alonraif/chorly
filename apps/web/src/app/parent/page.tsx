'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { choreTitle, dayKey, firstName, friendlyDay, greeting, now, timeOf } from '../../lib/format';
import { useSession } from '../../lib/session';
import { rangeQuery, type Chore, type Instance } from '../../lib/types';
import { Avatar, AvatarStack, ProgressRing } from '../../components/avatar';
import { ChoreEditor } from '../../components/chore-editor';
import { Icon } from '../../components/icon';
import { InstanceSheet } from '../../components/instance-sheet';
import { statusOf, StatusPill } from '../../components/status';
import { EmptyState, errorMessage } from '../../components/ui';

export default function ParentHomePage() {
  const { me, kids, approvalsCount } = useSession();
  const [items, setItems] = useState<Instance[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => now().toISODate() || '');
  const [kidFilter, setKidFilter] = useState<string | null>(null);
  const [openInstance, setOpenInstance] = useState<Instance | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; choreId?: string | null }>({ open: false });

  const days = useMemo(() => {
    const start = now().startOf('day');
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  }, []);

  const load = useCallback(async () => {
    try {
      const start = now().startOf('day');
      const [instances, choreList] = await Promise.all([
        api.get(rangeQuery(start.minus({ days: 7 }).toUTC().toISO() || '', start.plus({ days: 6 }).endOf('day').toUTC().toISO() || '')),
        api.get('/chores'),
      ]);
      setItems(instances);
      setChores(choreList);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load chores'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const todayKey = days[0].toISODate() || '';
  const overdue = items.filter((i) => statusOf(i) === 'overdue');
  const byDay = useMemo(() => {
    const map: Record<string, Instance[]> = {};
    for (const item of items) (map[dayKey(item.dueAt)] ||= []).push(item);
    return map;
  }, [items]);

  const todayItems = byDay[todayKey] || [];
  const agenda = (byDay[selectedDay] || []).filter((i) => !kidFilter || i.assignments.some((a) => a.userId === kidFilter));
  const rewardFor = (choreId: string) => chores.find((c) => c.id === choreId)?.rewardAmount ?? null;
  const selectedLabel = friendlyDay(days.find((d) => d.toISODate() === selectedDay) || days[0]);

  const openEditor = (choreId?: string | null) => {
    setOpenInstance(null);
    setEditor({ open: true, choreId });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{now().toFormat('EEEE, LLLL d')}</p>
          <h1>
            {greeting()}, {firstName(me.displayName)}
          </h1>
        </div>
        <button type="button" className="btn btn-primary hide-mobile" onClick={() => openEditor(null)}>
          <Icon name="plus" size={18} /> New chore
        </button>
      </header>

      {error && <p className="callout callout-error">{error}</p>}

      {loaded && kids.length === 0 && (
        <section className="onboard">
          <h2>Let’s get your family set up</h2>
          <ol className="onboard-steps">
            <li className="is-next">
              <span className="step-num">1</span>
              <span>
                <strong>Add your kids</strong>
                <span className="muted small">Each kid gets their own login for their phone.</span>
              </span>
              <Link href="/admin/users" className="btn btn-primary btn-sm">Add kids</Link>
            </li>
            <li>
              <span className="step-num">2</span>
              <span>
                <strong>Create a few chores</strong>
                <span className="muted small">Pick from suggestions — dishes, trash, pets.</span>
              </span>
            </li>
            <li>
              <span className="step-num">3</span>
              <span>
                <strong>Approve and pay</strong>
                <span className="muted small">Kids check off chores, you approve, they earn.</span>
              </span>
            </li>
          </ol>
        </section>
      )}

      {(approvalsCount > 0 || overdue.length > 0) && (
        <div className="alert-row">
          {approvalsCount > 0 && (
            <Link href="/parent/review" className="alert-card alert-waiting">
              <span className="alert-icon"><Icon name="approve" /></span>
              <span>
                <strong>{approvalsCount} waiting for approval</strong>
                <span className="small">Review and pay out</span>
              </span>
              <Icon name="chevronRight" size={18} />
            </Link>
          )}
          {overdue.length > 0 && (
            <Link href="/parent/review#overdue" className="alert-card alert-overdue">
              <span className="alert-icon"><Icon name="alert" /></span>
              <span>
                <strong>{overdue.length} overdue</strong>
                <span className="small">Reschedule or skip</span>
              </span>
              <Icon name="chevronRight" size={18} />
            </Link>
          )}
        </div>
      )}

      {kids.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Today</h2>
            {kidFilter && (
              <button type="button" className="link-btn" onClick={() => setKidFilter(null)}>Show everyone</button>
            )}
          </div>
          <div className="kid-progress-grid">
            {kids.map((kid) => {
              const mine = todayItems.filter((i) => i.assignments.some((a) => a.userId === kid.id));
              const done = mine.filter((i) => i.status !== 'assigned').length;
              const active = kidFilter === kid.id;
              return (
                <button
                  key={kid.id}
                  type="button"
                  className={`kid-progress ${active ? 'is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setKidFilter(active ? null : kid.id)}
                >
                  <ProgressRing value={done} total={mine.length} size={52}>
                    <Avatar user={kid} size={38} />
                  </ProgressRing>
                  <span className="kid-progress-text">
                    <strong>{firstName(kid.displayName)}</strong>
                    <span className="small muted">
                      {kid.isAway ? 'Away' : mine.length === 0 ? 'Nothing today' : done === mine.length ? 'All done 🎉' : `${done} of ${mine.length} done`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {kids.length > 0 && (
        <section className="section">
          <div className="day-strip" role="tablist" aria-label="Day">
            {days.map((d) => {
              const key = d.toISODate() || '';
              const count = (byDay[key] || []).length;
              const active = key === selectedDay;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`day-cell ${active ? 'is-active' : ''}`}
                  onClick={() => setSelectedDay(key)}
                >
                  <span className="day-cell-name">{key === todayKey ? 'Today' : d.toFormat('EEE')}</span>
                  <span className="day-cell-num">{d.day}</span>
                  <span className="day-cell-dots" aria-label={`${count} chores`}>
                    {Array.from({ length: Math.min(count, 4) }, (_, i) => <i key={i} />)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="list-card">
            {!loaded ? (
              <div className="skeleton-list">
                <span /><span /><span />
              </div>
            ) : agenda.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={`Nothing on ${selectedLabel === 'Today' ? 'today' : selectedLabel}`}
                action={
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditor(null)}>
                    <Icon name="plus" size={16} /> Add a chore
                  </button>
                }
              >
                {kidFilter ? 'No chores for this kid on this day.' : 'Enjoy the free time.'}
              </EmptyState>
            ) : (
              <ul className="rows">
                {agenda.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={`row row-${statusOf(item)}`} onClick={() => setOpenInstance(item)}>
                      <span className="row-time">{timeOf(item.dueAt)}</span>
                      <span className="row-main">
                        <span className="row-title">{choreTitle(item.chore)}</span>
                        <span className="row-sub">
                          <AvatarStack users={item.assignments.map((a) => ({ id: a.userId, displayName: a.displayName }))} size={20} />
                          {item.assignments.map((a) => firstName(a.displayName)).join(', ')}
                        </span>
                      </span>
                      <StatusPill instance={item} />
                      <Icon name="chevronRight" size={18} className="row-chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <button type="button" className="fab" onClick={() => openEditor(null)} aria-label="New chore">
        <Icon name="plus" size={26} />
      </button>

      <InstanceSheet
        instance={openInstance}
        onClose={() => setOpenInstance(null)}
        onChanged={load}
        onEditSeries={(id) => openEditor(id)}
        rewardFor={rewardFor}
      />
      <ChoreEditor open={editor.open} choreId={editor.choreId} onClose={() => setEditor({ open: false })} onSaved={load} />
    </div>
  );
}
