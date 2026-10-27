'use client';

import { DateTime } from 'luxon';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { choreTitle, dayKey, firstName, friendlyDay, greeting, longDate, now, timeOf, TZ, weekdayCodeOf, weekdayName } from '../../lib/format';
import { joinNames, t, tn } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { rangeQuery, type Chore, type Instance } from '../../lib/types';
import { Avatar, AvatarStack, ProgressRing } from '../../components/avatar';
import { ChoreEditor } from '../../components/chore-editor';
import { Icon } from '../../components/icon';
import { InstanceSheet } from '../../components/instance-sheet';
import { statusOf, StatusPill } from '../../components/status';
import { EmptyState, errorMessage, Segmented } from '../../components/ui';

type View = 'day' | 'week' | 'month';
const VIEWS: View[] = ['day', 'week', 'month'];
const VIEW_STORAGE_KEY = 'chorly.parentHomeView';

function readView(): View {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.includes(stored as View) ? (stored as View) : 'week';
  } catch {
    return 'week';
  }
}

function saveView(view: View) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Private mode or storage disabled: the view just isn't remembered.
  }
}

function toDay(key: string) {
  return DateTime.fromISO(key, { zone: TZ }).startOf('day');
}

function isoKey(day: DateTime) {
  return day.toISODate() || '';
}

function daysBetween(from: DateTime, to: DateTime) {
  return Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days);
}

function eachDay(from: DateTime, count: number) {
  return Array.from({ length: count }, (_, i) => from.plus({ days: i }));
}

export default function ParentHomePage() {
  const { me, kids, approvalsCount } = useSession();
  const [items, setItems] = useState<Instance[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => now().toISODate() || '');
  const [view, setView] = useState<View>('week');
  const [loadedRange, setLoadedRange] = useState('');
  const [kidFilter, setKidFilter] = useState<string | null>(null);
  const [openInstance, setOpenInstance] = useState<Instance | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; choreId?: string | null }>({ open: false });

  // Read the remembered view after mount so server and client render the same markup first.
  useEffect(() => {
    setView(readView());
  }, []);

  const changeView = (next: View) => {
    setView(next);
    saveView(next);
  };

  const today = now().startOf('day');
  const todayKey = isoKey(today);
  const selected = toDay(selectedDay);

  // Weeks page in 7-day steps from today, so the default week still starts today.
  const weekStart = today.plus({ days: Math.floor(daysBetween(today, selected) / 7) * 7 });
  const weekDays = eachDay(weekStart, 7);

  // Month grid: whole weeks, Sunday first (luxon weekday 7 = Sunday).
  const monthStart = selected.startOf('month');
  const gridStart = monthStart.minus({ days: monthStart.weekday % 7 });
  const monthEnd = selected.endOf('month').startOf('day');
  const gridEnd = monthEnd.plus({ days: 6 - (monthEnd.weekday % 7) });
  const gridDays = eachDay(gridStart, daysBetween(gridStart, gridEnd) + 1);

  const [rangeFrom, rangeTo] =
    view === 'day'
      ? [selectedDay, selectedDay]
      : view === 'week'
        ? [isoKey(weekStart), isoKey(weekDays[6])]
        : [isoKey(gridStart), isoKey(gridEnd)];
  const rangeKey = `${rangeFrom}|${rangeTo}`;

  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const start = now().startOf('day');
      const from = toDay(rangeFrom);
      const to = toDay(rangeTo).endOf('day');
      // The last 7 days and today are always needed (overdue alert, kid progress).
      const baseFrom = start.minus({ days: 7 });
      const baseTo = start.endOf('day');
      const iso = (d: DateTime) => d.toUTC().toISO() || '';
      const windows: Array<[DateTime, DateTime]> =
        from <= baseTo && to >= baseFrom
          ? [[DateTime.min(from, baseFrom), DateTime.max(to, baseTo)]]
          : [[baseFrom, baseTo], [from, to]];
      const [choreList, ...lists] = await Promise.all([
        api.get('/chores'),
        ...windows.map(([a, b]) => api.get(rangeQuery(iso(a), iso(b)))),
      ]);
      if (id !== requestId.current) return;
      const merged = new Map<string, Instance>();
      for (const list of lists as Instance[][]) for (const item of list) merged.set(item.id, item);
      setItems([...merged.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
      setChores(choreList);
      setLoadedRange(`${rangeFrom}|${rangeTo}`);
      setError('');
    } catch (err) {
      if (id !== requestId.current) return;
      setError(errorMessage(err, t('common.couldNotLoadChores')));
      setLoadedRange(`${rangeFrom}|${rangeTo}`);
    } finally {
      if (id === requestId.current) setLoaded(true);
    }
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    load();
  }, [load]);

  const fetching = !loaded || loadedRange !== rangeKey;
  const overdueFrom = isoKey(today.minus({ days: 7 }));
  const overdue = items.filter((i) => statusOf(i) === 'overdue' && dayKey(i.dueAt) >= overdueFrom);
  const forKid = useCallback(
    (list: Instance[]) => (kidFilter ? list.filter((i) => i.assignments.some((a) => a.userId === kidFilter)) : list),
    [kidFilter],
  );
  const byDay = useMemo(() => {
    const map: Record<string, Instance[]> = {};
    for (const item of forKid(items)) (map[dayKey(item.dueAt)] ||= []).push(item);
    return map;
  }, [items, forKid]);

  const todayItems = items.filter((i) => dayKey(i.dueAt) === todayKey);
  const agenda = byDay[selectedDay] || [];
  const rewardFor = (choreId: string) => chores.find((c) => c.id === choreId)?.rewardAmount ?? null;

  const step = (dir: 1 | -1) => {
    if (view === 'day') return setSelectedDay(isoKey(selected.plus({ days: dir })));
    if (view === 'week') return setSelectedDay(isoKey(selected.plus({ days: 7 * dir })));
    const target = monthStart.plus({ months: dir });
    setSelectedDay(target.hasSame(today, 'month') ? todayKey : isoKey(target));
  };
  const showsToday =
    view === 'day' ? selectedDay === todayKey : view === 'week' ? weekStart.equals(today) : selected.hasSame(today, 'month');
  const navTitle =
    view === 'day'
      ? selectedDay === todayKey
        ? t('common.today')
        : longDate(selected)
      : view === 'week'
        ? `${weekStart.toLocaleString({ month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleString({ month: 'short', day: 'numeric' })}`
        : selected.toLocaleString({ month: 'long', year: 'numeric' });
  const navLabels =
    view === 'day'
      ? [t('home.prevDay'), t('home.nextDay')]
      : view === 'week'
        ? [t('home.prevWeek'), t('home.nextWeek')]
        : [t('home.prevMonth'), t('home.nextMonth')];

  const openEditor = (choreId?: string | null) => {
    setOpenInstance(null);
    setEditor({ open: true, choreId });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{longDate(now())}</p>
          <h1>{t('greeting.withName', { greeting: greeting(), name: firstName(me.displayName) })}</h1>
        </div>
        <button type="button" className="btn btn-primary hide-mobile" onClick={() => openEditor(null)}>
          <Icon name="plus" size={18} /> {t('common.newChore')}
        </button>
      </header>

      {error && <p className="callout callout-error">{error}</p>}

      {loaded && kids.length === 0 && (
        <section className="onboard">
          <h2>{t('parent.onboardTitle')}</h2>
          <ol className="onboard-steps">
            <li className="is-next">
              <span className="step-num">1</span>
              <span>
                <strong>{t('parent.onboardKids')}</strong>
                <span className="muted small">{t('parent.onboardKidsHint')}</span>
              </span>
              <Link href="/admin/users" className="btn btn-primary btn-sm">{t('parent.onboardKidsCta')}</Link>
            </li>
            <li>
              <span className="step-num">2</span>
              <span>
                <strong>{t('parent.onboardChores')}</strong>
                <span className="muted small">{t('parent.onboardChoresHint')}</span>
              </span>
            </li>
            <li>
              <span className="step-num">3</span>
              <span>
                <strong>{t('parent.onboardApprove')}</strong>
                <span className="muted small">{t('parent.onboardApproveHint')}</span>
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
                <strong>{tn('parent.waiting', approvalsCount)}</strong>
                <span className="small">{t('parent.reviewPay')}</span>
              </span>
              <Icon name="chevronRight" size={18} />
            </Link>
          )}
          {overdue.length > 0 && (
            <Link href="/parent/review#overdue" className="alert-card alert-overdue">
              <span className="alert-icon"><Icon name="alert" /></span>
              <span>
                <strong>{tn('parent.overdue', overdue.length)}</strong>
                <span className="small">{t('parent.rescheduleSkip')}</span>
              </span>
              <Icon name="chevronRight" size={18} />
            </Link>
          )}
        </div>
      )}

      {kids.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('common.today')}</h2>
            {kidFilter && (
              <button type="button" className="link-btn" onClick={() => setKidFilter(null)}>{t('parent.showEveryone')}</button>
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
                      {kid.isAway
                        ? t('common.away')
                        : mine.length === 0
                          ? t('parent.nothingToday')
                          : done === mine.length
                            ? t('parent.allDone')
                            : t('parent.doneOf', { done, total: mine.length })}
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
          <div className="home-cal-head">
            <Segmented<View>
              label={t('home.view')}
              value={view}
              onChange={changeView}
              options={[
                { value: 'day', label: t('home.viewDay') },
                { value: 'week', label: t('home.viewWeek') },
                { value: 'month', label: t('home.viewMonth') },
              ]}
            />
            <div className="cal-nav">
              <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={navLabels[0]}>
                <Icon name="chevronLeft" size={20} />
              </button>
              <h2 className="cal-nav-title" aria-live="polite">{navTitle}</h2>
              <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={navLabels[1]}>
                <Icon name="chevronRight" size={20} />
              </button>
              {!showsToday && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedDay(todayKey)}>
                  {t('common.today')}
                </button>
              )}
            </div>
          </div>

          {view === 'week' && (
            <div className="day-strip" role="tablist" aria-label={t('parent.day')}>
              {weekDays.map((d) => {
                const key = isoKey(d);
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
                    <span className="day-cell-name">{key === todayKey ? t('common.today') : weekdayName(weekdayCodeOf(d), 'label')}</span>
                    <span className="day-cell-num">{d.day}</span>
                    <span className="day-cell-dots" aria-label={tn('chores.count', count)}>
                      {Array.from({ length: Math.min(count, 4) }, (_, i) => <i key={i} />)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'month' && (
            <div className="month-grid" role="grid" aria-label={t('home.calendar')}>
              <div className="month-row month-weekdays" role="row">
                {gridDays.slice(0, 7).map((d) => (
                  <span key={d.weekday} role="columnheader" className="month-weekday" title={weekdayName(weekdayCodeOf(d), 'long')}>
                    {d.toLocaleString({ weekday: 'narrow' })}
                  </span>
                ))}
              </div>
              {Array.from({ length: gridDays.length / 7 }, (_, w) => (
                <div key={w} className="month-row" role="row">
                  {gridDays.slice(w * 7, w * 7 + 7).map((d) => {
                    const key = isoKey(d);
                    const count = (byDay[key] || []).length;
                    const active = key === selectedDay;
                    const classes = [
                      'month-cell',
                      active ? 'is-active' : '',
                      key === todayKey ? 'is-today' : '',
                      d.hasSame(monthStart, 'month') ? '' : 'is-outside',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={key}
                        type="button"
                        role="gridcell"
                        aria-selected={active}
                        aria-label={`${longDate(d)}, ${tn('chores.count', count)}`}
                        className={classes}
                        onClick={() => setSelectedDay(key)}
                      >
                        <span className="month-cell-num">{d.day}</span>
                        <span className="day-cell-dots" aria-hidden="true">
                          {Array.from({ length: Math.min(count, 3) }, (_, i) => <i key={i} />)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {view === 'month' && <h3 className="agenda-title">{friendlyDay(selected)}</h3>}

          <div className="list-card">
            {fetching && agenda.length === 0 ? (
              <div className="skeleton-list">
                <span /><span /><span />
              </div>
            ) : agenda.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={
                  selectedDay === todayKey
                    ? t('parent.nothingOnToday')
                    : t('parent.nothingOn', { day: friendlyDay(selected) })
                }
                action={
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditor(null)}>
                    <Icon name="plus" size={16} /> {t('parent.addChore')}
                  </button>
                }
              >
                {kidFilter ? t('parent.noChoresKidDay') : t('parent.enjoy')}
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
                          {joinNames(item.assignments.map((a) => firstName(a.displayName)))}
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

      <button type="button" className="fab" onClick={() => openEditor(null)} aria-label={t('common.newChore')}>
        <Icon name="plus" size={26} />
      </button>

      <InstanceSheet
        instance={openInstance}
        onClose={() => setOpenInstance(null)}
        onChanged={load}
        onEditSeries={(id) => openEditor(id)}
        rewardFor={rewardFor}
      />
      <ChoreEditor
        open={editor.open}
        choreId={editor.choreId}
        defaultDate={selectedDay}
        onClose={() => setEditor({ open: false })}
        onSaved={load}
      />
    </div>
  );
}
