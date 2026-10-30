'use client';

import { firstName } from '../lib/format';
import { t } from '../lib/i18n';
import type { Instance } from '../lib/types';

export function ProofList({ instance }: { instance: Instance }) {
  if (instance.proofs.length === 0) return null;
  return (
    <div className="proof-list">
      {instance.proofs.map((proof) => {
        const src = `/api/instances/${instance.id}/proofs/${encodeURIComponent(proof.key)}`;
        const who = firstName(instance.assignments.find((a) => a.userId === proof.userId)?.displayName || '');
        const label = t('proof.review', { who });
        return proof.isVideo ? (
          // The #t offset makes iOS draw the first frame instead of a blank player.
          <video key={proof.key} className="proof-media" src={`${src}#t=0.1`} controls playsInline preload="metadata" aria-label={label} />
        ) : (
          <img key={proof.key} className="proof-media" src={src} alt={label} loading="lazy" />
        );
      })}
    </div>
  );
}
