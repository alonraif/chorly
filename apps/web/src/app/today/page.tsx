'use client';

import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../../lib/api';
import { getCurrentUserId } from '../../lib/user';

type Instance = {
  id: string;
  dueAt: string;
  status: string;
  chore: { title_en: string; title_he: string };
  doneByUserId: Record<string, { doneAt: string; undoneAt: string | null }>;
};

export default function TodayPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [error, setError] = useState('');

  const currentUser = getCurrentUserId();

  const range = useMemo(() => {
    const now = DateTime.now().setZone('Asia/Jerusalem');
    return {
      from: now.startOf('day').toUTC().toISO(),
      to: now.endOf('day').toUTC().toISO(),
    };
  }, []);

  async function load() {
    if (!currentUser) return;
    try {
      const data = await api.get(`/instances?from=${encodeURIComponent(range.from || '')}&to=${encodeURIComponent(range.to || '')}&userId=${currentUser}`);
      setInstances(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load today');
    }
  }

  useEffect(() => { load(); }, [currentUser]);

  async function markDone(id: string) {
    await api.post(`/instances/${id}/mark-done`, {});
    await load();
  }

  async function undo(id: string) {
    await api.post(`/instances/${id}/undo`, {});
    await load();
  }

  return (
    <div>
      <h2>Today</h2>
      {error && <p className="error">{error}</p>}
      {instances.map((instance) => {
        const mine = currentUser ? instance.doneByUserId[currentUser] : undefined;
        const done = !!mine && !mine.undoneAt;
        return (
          <div className="card" key={instance.id}>
            <h3>{instance.chore.title_he} / {instance.chore.title_en}</h3>
            <p>Due: {new Date(instance.dueAt).toLocaleString()}</p>
            <p>Status: {instance.status}</p>
            {done ? (
              <button onClick={() => undo(instance.id)}>Undo</button>
            ) : (
              <button onClick={() => markDone(instance.id)}>Mark done</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
