'use client';

import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type KeyboardEvent, type PointerEvent, type SetStateAction } from 'react';
import { api } from '../lib/api';
import { t, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useCamera } from '../lib/use-camera';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { errorMessage, Sheet, useUi } from './ui';

// Twice the largest size a picture is shown at, for sharp phone screens.
const PICTURE_SIDE = 320;

// How far in the slider and pinch can go, from the largest square that fits the picture.
const MAX_ZOOM = 4;

// The square being kept: its middle in picture pixels, and its zoom.
type Crop = { x: number; y: number; zoom: number };

function cropSide(image: HTMLImageElement, zoom: number) {
  return Math.min(image.naturalWidth, image.naturalHeight) / zoom;
}

function clampCrop(image: HTMLImageElement, crop: Crop): Crop {
  const half = cropSide(image, crop.zoom) / 2;
  return {
    ...crop,
    x: Math.min(Math.max(crop.x, half), image.naturalWidth - half),
    y: Math.min(Math.max(crop.y, half), image.naturalHeight - half),
  };
}

// Keeps the spot at (anchorX, anchorY), as fractions of the square, where it is on screen.
function zoomCrop(image: HTMLImageElement, crop: Crop, zoom: number, anchorX = 0.5, anchorY = 0.5) {
  const next = Math.min(Math.max(zoom, 1), MAX_ZOOM);
  const shrunk = cropSide(image, crop.zoom) - cropSide(image, next);
  return clampCrop(image, { x: crop.x + shrunk * (anchorX - 0.5), y: crop.y + shrunk * (anchorY - 0.5), zoom: next });
}

// Re-encoding also drops the location data photos carry.
function croppedJpeg(image: HTMLImageElement, crop: Crop) {
  const side = cropSide(image, crop.zoom);
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_SIDE;
  canvas.height = PICTURE_SIDE;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  // Transparent images would otherwise turn black as a JPEG.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, PICTURE_SIDE, PICTURE_SIDE);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, crop.x - side / 2, crop.y - side / 2, side, side, 0, 0, PICTURE_SIDE, PICTURE_SIDE);
  return new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
}

export function AvatarSheet({ onClose }: { onClose: () => void }) {
  const { me, avatars, refreshMembers } = useSession();
  const { toast } = useUi();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [picture, setPicture] = useState<{ image: HTMLImageElement; url: string } | null>(null);
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, zoom: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (picture) URL.revokeObjectURL(picture.url);
  }, [picture]);

  async function open(blob: Blob | null) {
    if (!blob) return setError(t('avatar.unreadable'));
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      setError('');
      setCapturing(false);
      setCrop({ x: image.naturalWidth / 2, y: image.naturalHeight / 2, zoom: 1 });
      setPicture({ image, url });
    } catch {
      URL.revokeObjectURL(url);
      setError(t('avatar.unreadable'));
    }
  }

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) open(file);
  }

  async function uploadCrop(image: HTMLImageElement) {
    const blob = await croppedJpeg(image, crop);
    if (!blob) throw new Error(t('avatar.unreadable'));
    await api.upload('/users/me/avatar', blob);
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
            <button type="button" className="btn btn-primary" onClick={() => change(() => uploadCrop(picture.image), 'avatar.saved')} disabled={busy}>
              <Icon name="check" size={18} /> {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        {picture ? (
          <AvatarCropper image={picture.image} url={picture.url} crop={crop} setCrop={setCrop} />
        ) : capturing ? (
          <AvatarCamera onShot={open} onCancel={() => setCapturing(false)} />
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

function AvatarCropper({
  image,
  url,
  crop,
  setCrop,
}: {
  image: HTMLImageElement;
  url: string;
  crop: Crop;
  setCrop: Dispatch<SetStateAction<Crop>>;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const side = cropSide(image, crop.zoom);

  // React's wheel listener is passive, and the sheet behind must not scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = stage.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY / 500);
      setCrop((c) => zoomCrop(image, c, c.zoom * factor, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [image, setCrop]);

  // The middle of the fingers and how far apart they are. One finger gives a spread of 0.
  function touchPoint() {
    const [a, b = a] = [...pointers.current.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const before = touchPoint();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = touchPoint();
    const box = e.currentTarget.getBoundingClientRect();
    setCrop((c) => {
      const scale = cropSide(image, c.zoom) / box.width;
      const moved = clampCrop(image, { ...c, x: c.x - (after.x - before.x) * scale, y: c.y - (after.y - before.y) * scale });
      if (!before.spread || !after.spread) return moved;
      return zoomCrop(image, moved, moved.zoom * (after.spread / before.spread), (after.x - box.left) / box.width, (after.y - box.top) / box.height);
    });
  }

  function pointerUp(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
  }

  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    setCrop((c) => {
      const distance = cropSide(image, c.zoom) * 0.05;
      return clampCrop(image, { ...c, x: c.x + step[0] * distance, y: c.y + step[1] * distance });
    });
  }

  return (
    <div className="avatar-choices">
      <div
        ref={stageRef}
        className="avatar-crop"
        role="group"
        tabIndex={0}
        aria-label={t('avatar.position')}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onKeyDown={keyDown}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            width: `${(image.naturalWidth / side) * 100}%`,
            left: `${((side / 2 - crop.x) / side) * 100}%`,
            top: `${((side / 2 - crop.y) / side) * 100}%`,
          }}
        />
      </div>
      <input
        className="avatar-zoom"
        type="range"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={crop.zoom}
        onChange={(e) => {
          const zoom = Number(e.target.value);
          setCrop((c) => zoomCrop(image, c, zoom));
        }}
        aria-label={t('avatar.zoom')}
      />
      <p className="field-hint">{t('avatar.adjust')}</p>
    </div>
  );
}

function AvatarCamera({ onShot, onCancel }: { onShot: (blob: Blob | null) => void; onCancel: () => void }) {
  const [facing, setFacing] = useState<'environment' | 'user'>('user');
  const { videoRef, attachVideo, cameraError } = useCamera(facing, true);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return onShot(null);
    context.drawImage(video, 0, 0);
    onShot(await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.92)));
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
