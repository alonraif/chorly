'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { choreTitle, firstName } from '../lib/format';
import { joinNames, t } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Instance } from '../lib/types';
import { Icon } from './icon';
import { errorMessage, Sheet, useUi } from './ui';

// Sends a finished chore back to not done. The reason is optional and goes in the notification.
export function RejectSheet({
  instance,
  onClose,
  onRejected,
}: {
  instance: Instance | null;
  onClose: () => void;
  onRejected: () => void;
}) {
  const { refreshApprovals } = useSession();
  const { toast } = useUi();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setReason('');
    setError('');
  }, [instance]);

  if (!instance) return null;
  const who = joinNames(
    instance.assignments
      .filter((a) => {
        const done = instance.doneByUserId[a.userId];
        return !!done && !done.undoneAt;
      })
      .map((a) => firstName(a.displayName)),
  );

  async function reject() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/instances/${instance!.id}/reject`, { reason: reason.trim() || undefined });
      toast(t('approvals.rejected', { who }));
      onRejected();
      refreshApprovals().catch(() => undefined);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('approvals.rejectFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('approvals.rejectTitle', { chore: choreTitle(instance.chore) })}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger" onClick={reject} disabled={busy}>
            <Icon name="x" size={18} /> {t('common.reject')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('approvals.rejectBody', { who })}</p>
        <label className="field">
          <span className="field-label-sm">{t('approvals.rejectReason')}</span>
          <textarea
            className="input"
            rows={3}
            maxLength={300}
            value={reason}
            placeholder={t('approvals.rejectReasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && <p className="callout callout-error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
