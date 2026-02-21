'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getCurrentUserId } from '../../lib/user';

type Instance = {
  id: string;
  dueAt: string;
  status: string;
  chore: { title_en: string; title_he: string };
};

export default function WeekPage() {
  const [items, setItems] = useState<Instance[]>([]);
  const [error, setError] = useState('');
  const currentUser = getCurrentUserId();

  const range = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    api.get(`/instances?from=${encodeURIComponent(range.from || '')}&to=${encodeURIComponent(range.to || '')}&userId=${currentUser}`)
      .then(setItems)
      .catch((e) => setError(e.message || String(e)));
  }, [currentUser]);

  const grouped = items.reduce<Record<string, Instance[]>>((acc, item) => {
    const day = new Date(item.dueAt).toISOString().slice(0, 10) || 'unknown';
    acc[day] = acc[day] || [];
    acc[day].push(item);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-title">
        <h2>Week</h2>
        <p className="lead">Seven-day timeline grouped by due date.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="cards-grid">
        {Object.keys(grouped).sort().map((day) => (
          <section className="card" key={day}>
            <h3>{day}</h3>
            <ul className="list">
              {grouped[day].map((item) => (
                <li key={item.id}>{item.chore.title_he} / {item.chore.title_en} ({item.status})</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
