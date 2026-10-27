'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { choreTitle, firstName, money, scheduleSummary } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import type { Chore } from '../../../lib/types';
import { Avatar, AvatarStack } from '../../../components/avatar';
import { ChoreEditor } from '../../../components/chore-editor';
import { Icon } from '../../../components/icon';
import { EmptyState, errorMessage } from '../../../components/ui';

type EditorState = { open: boolean; choreId?: string | null; template?: Chore | null };

export default function ChoresPage() {
  const { kids, currency } = useSession();
  const [chores, setChores] = useState<Chore[]>([]);
  const [templates, setTemplates] = useState<Chore[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [kidFilter, setKidFilter] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ open: false });

  const load = useCallback(async () => {
    try {
      const [list, tpl] = await Promise.all([api.get('/chores'), api.get('/templates').catch(() => [])]);
      setChores(list);
      setTemplates(tpl);
      setError('');
    } catch (err) {
      setError(errorMessage(err, t('common.couldNotLoadChores')));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    // Deep links: /admin/chores#new-chore and /admin/chores?edit=series&choreId=…
    const query = new URLSearchParams(window.location.search);
    const choreId = query.get('choreId');
    if (choreId) setEditor({ open: true, choreId });
    else if (window.location.hash === '#new-chore') setEditor({ open: true });
  }, [load]);

  const closeEditor = () => {
    setEditor({ open: false });
    if (window.location.search || window.location.hash) window.history.replaceState(null, '', '/admin/chores');
  };

  const kidName = (id: string) => kids.find((k) => k.id === id);
  const visible = chores.filter((c) => !kidFilter || c.assignmentJson?.assigneeIds?.includes(kidFilter));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('nav.chores')}</h1>
          <p className="muted">{t('choresPage.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditor({ open: true })}>
          <Icon name="plus" size={18} /> {t('common.newChore')}
        </button>
      </header>

      {error && <p className="callout callout-error">{error}</p>}

      {kids.length > 1 && chores.length > 0 && (
        <div className="chip-row filter-row" role="group" aria-label={t('choresPage.filterByKid')}>
          <button type="button" className={`chip ${!kidFilter ? 'is-on' : ''}`} aria-pressed={!kidFilter} onClick={() => setKidFilter(null)}>
            {t('common.everyone')}
          </button>
          {kids.map((kid) => (
            <button
              key={kid.id}
              type="button"
              className={`chip chip-person ${kidFilter === kid.id ? 'is-on' : ''}`}
              aria-pressed={kidFilter === kid.id}
              onClick={() => setKidFilter(kidFilter === kid.id ? null : kid.id)}
            >
              <Avatar user={kid} size={22} /> {firstName(kid.displayName)}
            </button>
          ))}
        </div>
      )}

      <div className="list-card">
        {!loaded ? (
          <div className="skeleton-list"><span /><span /><span /></div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="list"
            title={chores.length === 0 ? t('choresPage.noneYet') : t('choresPage.noneForKid')}
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditor({ open: true })}>
                <Icon name="plus" size={16} /> {t('common.newChore')}
              </button>
            }
          >
            {chores.length === 0 ? t('choresPage.createHint') : undefined}
          </EmptyState>
        ) : (
          <ul className="rows">
            {visible.map((chore) => {
              const people = (chore.assignmentJson?.assigneeIds || []).map(kidName).filter(Boolean) as typeof kids;
              const takesTurns = people.length > 1;
              return (
                <li key={chore.id}>
                  <button type="button" className="row" onClick={() => setEditor({ open: true, choreId: chore.id })}>
                    <span className="chore-tile" aria-hidden="true">{choreTitle(chore).slice(0, 1).toUpperCase()}</span>
                    <span className="row-main">
                      <span className="row-title">{choreTitle(chore)}</span>
                      <span className="row-sub">
                        <Icon name={chore.scheduleJson?.type === 'one_time' ? 'calendar' : 'repeat'} size={14} />
                        {scheduleSummary(chore.scheduleJson)}
                      </span>
                    </span>
                    {chore.hasReward && chore.rewardAmount && (
                      <span className="pill pill-coin">
                        <Icon name="coin" size={14} /> {money(chore.rewardAmount, currency)}
                      </span>
                    )}
                    <span className="row-people" title={takesTurns ? t('choresPage.takesTurns') : undefined}>
                      <AvatarStack users={people} size={26} />
                      {takesTurns && <Icon name="repeat" size={14} />}
                    </span>
                    <Icon name="chevronRight" size={18} className="row-chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {loaded && templates.length > 0 && chores.length < 6 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('choresPage.quickAdd')}</h2>
          </div>
          <div className="template-grid">
            {templates.slice(0, 9).map((t) => (
              <button key={t.id} type="button" className="template-card" onClick={() => setEditor({ open: true, template: t })}>
                <span className="row-title">{choreTitle(t)}</span>
                <span className="small muted">{scheduleSummary(t.scheduleJson)}</span>
                <Icon name="plus" size={18} className="template-plus" />
              </button>
            ))}
          </div>
        </section>
      )}

      <ChoreEditor
        open={editor.open}
        choreId={editor.choreId}
        template={editor.template}
        onClose={closeEditor}
        onSaved={load}
      />
    </div>
  );
}
