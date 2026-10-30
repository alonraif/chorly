'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../lib/api';
import { t, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useCamera } from '../lib/use-camera';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { errorMessage, Sheet, useUi } from './ui';

// Twice the largest size a picture is shown at, for sharp phone screens.
const PICTURE_SIDE = 320;

// Crops the middle square and re-encodes, which also drops the location data photos carry.
function squareJpeg(source: CanvasImageSource, width: number, height: number) {
  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_SIDE;
  canvas.height = PICTURE_SIDE;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  // Transparent images would otherwise turn black as a JPEG.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, PICTURE_SIDE, PICTURE_SIDE);
  context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, PICTURE_SIDE, PICTURE_SIDE);
  return new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
}

export function AvatarSheet({ onClose }: { onClose: () => void }) {
  const { me, avatars, refreshMembers } = useSession();
  const { toast } = useUi();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (picture) URL.revokeObjectURL(picture.url);
  }, [picture]);

  function keep(blob: Blob | null) {
    if (!blob) return setError(t('avatar.unreadable'));
    setError('');
    setCapturing(false);
    setPicture({ blob, url: URL.createObjectURL(blob) });
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      keep(await squareJpeg(image, image.naturalWidth, image.naturalHeight));
    } catch {
      setError(t('avatar.unreadable'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function change(request: () => Promise<unknown>, done: MessageKey) {
    setBusy(true);
    setError('');
    try {
      await request();
      await refreshMembers();
      toast(t(done));
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('avatar.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('avatar.title')}
      size="sm"
      footer={
        picture ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPicture(null)} disabled={busy}>{t('common.back')}</button>
            <button type="button" className="btn btn-primary" onClick={() => change(() => api.upload('/users/me/avatar', picture.blob), 'avatar.saved')} disabled={busy}>
              <Icon name="check" size={18} /> {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        {picture ? (
          <div className="avatar-choices">
            <img className="avatar-preview" src={picture.url} alt={t('avatar.title')} />
          </div>
        ) : capturing ? (
          <AvatarCamera onShot={keep} onCancel={() => setCapturing(false)} />
        ) : (
          <div className="avatar-choices">
            <Avatar user={me} size={120} />
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} data-autofocus>
              <Icon name="image" size={18} /> {t('avatar.gallery')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setCapturing(true)}>
              <Icon name="camera" size={18} /> {t('avatar.camera')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
            {avatars[me.id] && (
              <button type="button" className="btn btn-ghost-danger" onClick={() => change(() => api.delete('/users/me/avatar'), 'avatar.removed')} disabled={busy}>
                <Icon name="trash" size={18} /> {t('avatar.remove')}
              </button>
            )}
          </div>
        )}
        {error && <p className="callout callout-error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}

function AvatarCamera({ onShot, onCancel }: { onShot: (blob: Blob | null) => void; onCancel: () => void }) {
  const [facing, setFacing] = useState<'environment' | 'user'>('user');
  const { videoRef, attachVideo, cameraError } = useCamera(facing, true);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    onShot(await squareJpeg(video, video.videoWidth, video.videoHeight));
  }

  if (cameraError) {
    return (
      <>
        <p className="callout callout-error" role="alert">{cameraError}</p>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('common.back')}</button>
      </>
    );
  }

  return (
    <div className="proof-stage is-square">
      <video ref={attachVideo} autoPlay muted playsInline />
      <button
        type="button"
        className="icon-btn proof-flip"
        onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
        aria-label={t('proof.flip')}
      >
        <Icon name="repeat" />
      </button>
      <button type="button" className="proof-shutter" onClick={takePhoto} aria-label={t('proof.takePhoto')} />
    </div>
  );
}
