'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hueFor, initials } from '../../../components/avatar';
import { Icon } from '../../../components/icon';
import { api } from '../../../lib/api';
import { choreTitle, firstName, now, timeOf, zoned, type ChoreTitle } from '../../../lib/format';
import { applyLocale, getLocale, t, type Locale } from '../../../lib/i18n';
import './display.css';

type ChoreState = 'todo' | 'overdue' | 'waiting' | 'approved';
type BoardChore = ChoreTitle & { id: string; dueAt: string; state: ChoreState };
type BoardMember = { id: string; displayName: string; avatarAt: string | null };
type BoardColumn = { id: string; members: BoardMember[]; chores: BoardChore[]; missed: number };
type Board = { family: { name: string; locale: Locale }; sun: { rise: string; set: string }; columns: BoardColumn[] };

const REFRESH_MS = 30_000;
const CLOCK_MS = 15_000;
const MAX_TEXT = 44;
const MIN_TEXT = 22;
const ANY_LENGTH = Number.POSITIVE_INFINITY;
const ROOM_FOR_NAME = 32;
// Past this, a shared column shows faces only: the names wouldn't fit.
const MAX_NAMES = 2;

const isFinished = (chore: BoardChore) => chore.state === 'waiting' || chore.state === 'approved';
const rowOrder = (chore: BoardChore) => (chore.state === 'overdue' ? 0 : isFinished(chore) ? 2 : 1);

export default function DisplayPage() {
  const { token } = useParams<{ token: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [linkOff, setLinkOff] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [clock, setClock] = useState(now);
  const [rowLimit, setRowLimit] = useState(ANY_LENGTH);
  const columns = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const next: Board = await api.get(`/display/${token}`);
      // The room's language, not the language of whoever last used this device.
      if (next.family.locale !== getLocale()) applyLocale(next.family.locale);
      setBoard(next);
      setRowLimit(ANY_LENGTH);
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

  const night = !!board && (clock < zoned(board.sun.rise) || clock >= zoned(board.sun.set));
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'dark' : 'light';
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [night]);

  // Largest text that fits every chore in full. Hiding rows is the last resort, for a day too long to fit at all.
  const fit = useCallback(() => {
    const el = columns.current;
    if (!el) return;
    const overflows = () => Array.from(el.children).some((column) => column.scrollHeight > column.clientHeight + 1);
    let size = MAX_TEXT;
    el.style.setProperty('--text', `${size}px`);
    while (size > MIN_TEXT && overflows()) {
      size -= 1;
      el.style.setProperty('--text', `${size}px`);
    }
    if (overflows()) {
      const longest = Math.max(...(board?.columns ?? []).map((c) => c.chores.length));
      setRowLimit((limit) => Math.max(1, Math.min(limit, longest) - 1));
    }
  }, [board]);

  useLayoutEffect(fit, [fit, rowLimit]);
  useEffect(() => {
    document.fonts?.ready.then(fit);
  }, [fit]);

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
        <div className="display-date">
          <strong>{clock.toLocaleString({ weekday: 'long' })}</strong>
          <span>{clock.toLocaleString({ month: 'long', day: 'numeric' })}</span>
          {offline && updatedAt && <span className="display-offline">{t('display.offline', { time: timeOf(updatedAt) })}</span>}
        </div>
        <time className="display-clock">{clock.toFormat('HH:mm')}</time>
      </header>
      {board.columns.length === 0 ? (
        <p className="display-free">{t('display.nothingToday')}</p>
      ) : (
        <div className="display-people" ref={columns}>
          {board.columns.map((column) => (
            <ChoreColumn key={column.id} column={column} token={token} rowLimit={rowLimit} />
          ))}
        </div>
      )}
    </main>
  );
}

function ChoreColumn({ column, token, rowLimit }: { column: BoardColumn; token: string; rowLimit: number }) {
  const { members } = column;
  const showNames = members.length <= MAX_NAMES;
  // What's left comes first, so a day too long to fit only ever hides finished chores.
  const chores = [...column.chores].sort(
    (a, b) => rowOrder(a) - rowOrder(b) || a.dueAt.localeCompare(b.dueAt),
  );
  const shown = chores.slice(0, rowLimit);
  const hidden = chores.length - shown.length;
  const textLength = chores.reduce((total, chore) => total + choreTitle(chore).length, 0);
  const nameRoom = ROOM_FOR_NAME * (showNames ? members.length : 1);

  return (
    // Width follows the amount of text, so everyone's chores can stay the same large size.
    <section className={`display-person ${members.length > 1 ? 'is-shared' : ''}`} style={{ flexGrow: textLength + nameRoom }}>
      <header>
        <span className="display-faces" aria-hidden="true">
          {members.map((member) => (
            <span key={member.id} className="avatar" style={{ ['--hue' as any]: hueFor(member.id) }}>
              {member.avatarAt ? (
                <img src={`/api/display/${token}/avatars/${member.id}?v=${encodeURIComponent(member.avatarAt)}`} alt="" />
              ) : (
                initials(member.displayName)
              )}
            </span>
          ))}
        </span>
        {showNames && <h2><bdi>{members.map((m) => firstName(m.displayName)).join(' + ')}</bdi></h2>}
      </header>
      <ul>
        {shown.map((chore) => (
          <li key={chore.id} className={isFinished(chore) ? 'is-finished' : chore.state === 'overdue' ? 'is-overdue' : undefined}>
            <span className="display-mark" aria-hidden="true">
              {isFinished(chore) && <Icon name="check" />}
            </span>
            <bdi>{choreTitle(chore)}</bdi>
          </li>
        ))}
      </ul>
      {(hidden > 0 || column.missed > 0) && (
        <footer>
          {hidden > 0 && <span>{t('display.more', { count: hidden })}</span>}
          {column.missed > 0 && <span className="display-missed">{t('display.missed', { count: column.missed })}</span>}
        </footer>
      )}
    </section>
  );
}
