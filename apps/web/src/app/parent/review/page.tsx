'use client';

import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../../../lib/api';

type Instance = {
  id: string;
  dueAt: string;
  status: 'assigned' | 'done' | 'approved';
  rewardAmount: string | null;
  chore: { title_en: string; title_he: string; hasReward: boolean };
};

export default function ParentReviewPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    const now = DateTime.now().setZone('Asia/Jerusalem');
    return {
      from: now.minus({ days: 30 }).startOf('day').toUTC().toISO(),
      to: now.plus({ days: 7 }).endOf('day').toUTC().toISO(),
    };
  }, []);

  const load = () => api.get(`/instances?from=${encodeURIComponent(range.from || '')}&to=${encodeURIComponent(range.to || '')}`)
    .then(setInstances)
    .catch((e) => setError(e.message || String(e)));

  useEffect(() => { load(); }, []);

  const now = Date.now();
  const doneNotApproved = instances.filter((i) => i.status === 'done');
  const overdue = instances.filter((i) => i.status !== 'approved' && new Date(i.dueAt).getTime() < now);

  async function approve(instance: Instance) {
    try {
      const rewardAmount = instance.chore.hasReward ? window.prompt('Reward amount', instance.rewardAmount || '10.00') : undefined;
      await api.post(`/instances/${instance.id}/approve`, rewardAmount ? { rewardAmount } : {});
      await load();
    } catch (e: any) {
      setError(e.message || 'Approve failed');
    }
  }

  return (
    <div>
      <h2>Parent Review</h2>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>Done but not approved</h3>
        <ul>
          {doneNotApproved.map((instance) => (
            <li key={instance.id}>
              {instance.chore.title_he} / {instance.chore.title_en}
              <button onClick={() => approve(instance)}>Approve</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>Overdue</h3>
        <ul>
          {overdue.map((instance) => (
            <li key={instance.id}>{instance.chore.title_he} / {instance.chore.title_en} ({new Date(instance.dueAt).toLocaleString()})</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
