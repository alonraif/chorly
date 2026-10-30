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
import { TemplateSheet } from '../../../components/template-sheet';
import { EmptyState, errorMessage, useUi } from '../../../components/ui';
import './quick-add.css';

type EditorState = { open: boolean; choreId?: string | null; template?: Chore | null };
type SuggestionState = { open: boolean; template?: Chore | null };

export default function ChoresPage() {
  const { people, currency } = useSession();
  const [chores, setChores] = useState<Chore[]>([]);
  const [templates, setTemplates] = useState<Chore[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [kidFilter, setKidFilter] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [managing, setManaging] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestionState>({ open: false });
  const { confirm, toast } = useUi();

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

  const removeTemplate = async (tpl: Chore) => {
    const title = choreTitle(tpl);
    const ok = await confirm({
      title: t('quickAdd.deleteTitle', { title }),
      body: t('quickAdd.deleteBody'),
      confirmLabel: t('quickAdd.deleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/templates/${tpl.id}`);
      setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
      toast(t('quickAdd.deleted'));
    } catch (err) {
      toast(errorMessage(err, t('quickAdd.couldNotDelete')), 'error');
    }
  };

  const personOf = (id: string) => people.find((p) => p.id === id);
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

      {people.length > 1 && chores.length > 0 && (
        <div className="chip-row filter-row" role="group" aria-label={t('choresPage.filterByKid')}>
          <button type="button" className={`chip ${!kidFilter ? 'is-on' : ''}`} aria-pressed={!kidFilter} onClick={() => setKidFilter(null)}>
            {t('common.everyone')}
          </button>
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              className={`chip chip-person ${kidFilter === person.id ? 'is-on' : ''}`}
              aria-pressed={kidFilter === person.id}
              onClick={() => setKidFilter(kidFilter === person.id ? null : person.id)}
            >
              <Avatar user={person} size={22} /> {firstName(person.displayName)}
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
              const assignees = (chore.assignmentJson?.assigneeIds || []).map(personOf).filter(Boolean) as typeof people;
              const takesTurns = assignees.length > 1;
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
                      <AvatarStack users={assignees} size={26} />
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

      {loaded && (
        <section className={`section qa-section ${managing ? 'qa-managing' : ''}`}>
          <div className="section-head">
            <h2>{t('choresPage.quickAdd')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={managing} onClick={() => setManaging((v) => !v)}>
              {managing ? (
                <><Icon name="check" size={16} /> {t('quickAdd.done')}</>
              ) : (
                <><Icon name="edit" size={16} /> {t('quickAdd.manage')}</>
              )}
            </button>
          </div>
          <p className="small muted qa-hint">
            {managing ? t('quickAdd.manageHint') : templates.length === 0 ? t('quickAdd.empty') : t('quickAdd.hint')}
          </p>
          <div className="template-grid qa-grid">
            {templates.map((tpl) => {
              const title = choreTitle(tpl);
              const body = (
                <>
                  <span className="row-title">{title}</span>
                  <span className="small muted">{scheduleSummary(tpl.scheduleJson)}</span>
                </>
              );
              return (
                <div key={tpl.id} className="qa-item">
                  {managing ? (
                    <>
                      <div className="template-card">{body}</div>
                      <div className="qa-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('quickAdd.editItem', { title })}
                          title={t('quickAdd.editItem', { title })}
                          onClick={() => setSuggestion({ open: true, template: tpl })}
                        >
                          <Icon name="edit" size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn qa-delete"
                          aria-label={t('quickAdd.deleteItem', { title })}
                          title={t('quickAdd.deleteItem', { title })}
                          onClick={() => removeTemplate(tpl)}
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <button type="button" className="template-card" onClick={() => setEditor({ open: true, template: tpl })}>
                      {body}
                      <Icon name="plus" size={18} className="template-plus" />
                    </button>
                  )}
                </div>
              );
            })}
            {(managing || templates.length === 0) && (
              <button type="button" className="qa-add-card" onClick={() => setSuggestion({ open: true })}>
                <Icon name="plus" size={18} /> {t('quickAdd.add')}
              </button>
            )}
          </div>
        </section>
      )}

      <TemplateSheet
        open={suggestion.open}
        template={suggestion.template}
        onClose={() => setSuggestion({ open: false })}
        onSaved={load}
      />

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
