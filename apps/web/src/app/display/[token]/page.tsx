'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProgressRing, hueFor, initials } from '../../../components/avatar';
import { Icon } from '../../../components/icon';
import { api } from '../../../lib/api';
import { choreTitle, firstName, longDate, now, timeOf, type ChoreTitle } from '../../../lib/format';
import { applyLocale, getLocale, t, type Locale } from '../../../lib/i18n';
import './display.css';

type ChoreState = 'todo' | 'overdue' | 'waiting' | 'approved';
type BoardChore = ChoreTitle & { id: string; dueAt: string; state: ChoreState };
type BoardKid = { id: string; displayName: string; avatarAt: string | null; isAway: boolean; chores: BoardChore[]; missed: number };
type Board = { family: { name: string; locale: Locale }; kids: BoardKid[] };

const REFRESH_MS = 30_000;
const CLOCK_MS = 15_000;
// What's left to do comes first, so a long list only ever hides finished chores.
const STATE_ORDER: Record<ChoreState, number> = { overdue: 0, todo: 1, waiting: 2, approved: 3 };

const isFinished = (chore: BoardChore) => chore.state === 'waiting' || chore.state === 'approved';

function isNight(hour: number) {
  return hour >= 19 || hour < 7;
}

export default function DisplayPage() {
  const { token } = useParams<{ token: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [linkOff, setLinkOff] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [clock, setClock] = useState(now);

  const load = useCallback(async () => {
    try {
      const next: Board = await api.get(`/display/${token}`);
      // The room's language, not the language of whoever last used this device.
      if (next.family.locale !== getLocale()) applyLocale(next.family.locale);
      setBoard(next);
      setUpdatedAt(new Date().toISOString());
      setOffline(false);
      setLinkOff(false);
    } catch (err) {
      // Keep the last board up through a blip; only a dead link clears the screen.
      if (err instanceof Error && err.message === 'Display link not found') setLinkOff(true);
      else setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, REFRESH_MS);
    const tick = window.setInterval(() => setClock(now()), CLOCK_MS);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [load]);

  const night = isNight(clock.hour);
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'dark' : 'light';
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [night]);

  if (linkOff) {
    return (
      <main className="display display-message">
        <h1>{t('display.linkOff')}</h1>
        <p>{t('display.linkOffHint')}</p>
      </main>
    );
  }
  if (!board) return <main className="display" />;

  return (
    <main className="display">
      <header className="display-head">
        <div>
          <h1><bdi>{board.family.name}</bdi></h1>
          <p>{longDate(clock)}</p>
        </div>
        <div className="display-time">
          {offline && updatedAt && <span className="display-offline">{t('display.offline', { time: timeOf(updatedAt) })}</span>}
          <strong>{clock.toFormat('HH:mm')}</strong>
        </div>
      </header>
      <div className="display-kids" style={{ ['--columns' as any]: Math.min(board.kids.length, 4) }}>
        {board.kids.map((kid) => (
          <KidColumn key={kid.id} kid={kid} token={token} maxRows={board.kids.length > 4 ? 3 : 7} />
        ))}
      </div>
    </main>
  );
}

function KidColumn({ kid, token, maxRows }: { kid: BoardKid; token: string; maxRows: number }) {
  const chores = [...kid.chores].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.dueAt.localeCompare(b.dueAt));
  const finished = chores.filter(isFinished).length;
  const hidden = Math.max(0, chores.length - maxRows);
  const shown = chores.slice(0, hidden ? maxRows - 1 : maxRows);
  const allDone = chores.length > 0 && finished === chores.length;

  return (
    <section className={`display-kid${allDone ? ' is-complete' : ''}`}>
      <header>
        <span className="avatar" style={{ ['--hue' as any]: hueFor(kid.id), width: 44, height: 44, fontSize: 18 }} aria-hidden="true">
          {kid.avatarAt ? (
            <img src={`/api/display/${token}/avatars/${kid.id}?v=${encodeURIComponent(kid.avatarAt)}`} alt="" />
          ) : (
            initials(kid.displayName)
          )}
        </span>
        <h2><bdi>{firstName(kid.displayName)}</bdi></h2>
        <ProgressRing value={finished} total={chores.length} size={44} stroke={5}>
          <span className="display-count">{finished}/{chores.length}</span>
        </ProgressRing>
      </header>
      {chores.length === 0 ? (
        <p className="display-empty">{kid.isAway ? t('common.away') : t('display.nothingToday')}</p>
      ) : allDone ? (
        <p className="display-done"><Icon name="check" size={28} /> {t('display.allDone')}</p>
      ) : (
        <ul>
          {shown.map((chore) => (
            <li key={chore.id} className={`display-chore is-${chore.state}`}>
              <span className="display-mark" aria-hidden="true">
                {isFinished(chore) && <Icon name="check" size={16} />}
              </span>
              <span className="display-title"><bdi>{choreTitle(chore)}</bdi></span>
              {chore.state === 'overdue' && <span className="display-flag">{t('status.overdue')}</span>}
            </li>
          ))}
          {hidden > 0 && <li className="display-more">{t('display.more', { count: hidden + 1 })}</li>}
        </ul>
      )}
      {kid.missed > 0 && <p className="display-missed">{t('display.missed', { count: kid.missed })}</p>}
    </section>
  );
}
