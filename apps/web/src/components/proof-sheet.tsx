'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { choreTitle } from '../lib/format';
import { t } from '../lib/i18n';
import type { Instance } from '../lib/types';
import { Icon } from './icon';
import { errorMessage, Sheet } from './ui';

const MAX_VIDEO_SECONDS = 15;
const MAX_PHOTO_SIDE = 1600;
// mp4 first: it's the format that plays on every parent's phone.
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

// Capture happens on a live camera stream on purpose: a file input can always
// fall back to the photo library, so proof here can only come from the camera.
export function ProofSheet({
  instance,
  onClose,
  onDone,
}: {
  instance: Instance | null;
  onClose: () => void;
  onDone: (instance: Instance) => void;
}) {
  if (!instance) return null;
  return <Capture key={instance.id} instance={instance} onClose={onClose} onDone={onDone} />;
}

function Capture({ instance, onClose, onDone }: { instance: Instance; onClose: () => void; onDone: (instance: Instance) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Sheet mounts its content a render late, so the stream can arrive before the video element.
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (video) video.srcObject = streamRef.current;
  }, []);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [sendError, setSendError] = useState('');
  const [busy, setBusy] = useState(false);
  const videoType = recorderType();
  const recording = secondsLeft !== null;

  useEffect(() => {
    if (shot) return;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t('proof.unavailable'));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraError('');
      })
      .catch((err: DOMException) => setCameraError(t(err.name === 'NotAllowedError' ? 'proof.denied' : 'proof.unavailable')));
    return () => {
      cancelled = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [facing, shot]);

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft === 0) {
      recorderRef.current?.stop();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  function keep(blob: Blob) {
    setShot({ blob, url: URL.createObjectURL(blob) });
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && keep(blob), 'image/jpeg', 0.85);
  }

  function startRecording() {
    if (!streamRef.current || !videoType) return;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: videoType, videoBitsPerSecond: 1_500_000 });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      setSecondsLeft(null);
      recorderRef.current = null;
      if (streamRef.current) keep(new Blob(chunks, { type: videoType.split(';')[0] }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setSecondsLeft(MAX_VIDEO_SECONDS);
  }

  async function send() {
    if (!shot) return;
    setBusy(true);
    setSendError('');
    try {
      const { key } = await api.upload(`/instances/${instance.id}/proof`, shot.blob);
      await api.post(`/instances/${instance.id}/mark-done`, { photoKeys: [key] });
      onDone(instance);
      onClose();
    } catch (err) {
      setSendError(errorMessage(err, t('proof.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('proof.title')}
      subtitle={choreTitle(instance.chore)}
      size="sm"
      footer={
        shot ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShot(null)} disabled={busy}>{t('proof.retake')}</button>
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>
              <Icon name="check" size={18} /> {t('proof.send')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        {cameraError ? (
          <p className="callout callout-error" role="alert">{cameraError}</p>
        ) : (
          <>
            {!shot && videoType && (
              <div className="chip-row">
                {(['photo', 'video'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`chip ${mode === option ? 'is-on' : ''}`}
                    aria-pressed={mode === option}
                    disabled={recording}
                    onClick={() => setMode(option)}
                  >
                    <Icon name={option === 'photo' ? 'camera' : 'video'} size={16} /> {t(option === 'photo' ? 'proof.photo' : 'proof.video')}
                  </button>
                ))}
              </div>
            )}
            <div className="proof-stage">
              {shot ? (
                shot.blob.type.startsWith('video/') ? (
                  <video className="is-review" src={shot.url} controls playsInline />
                ) : (
                  <img className="is-review" src={shot.url} alt={t('proof.photo')} />
                )
              ) : (
                <>
                  <video ref={attachVideo} autoPlay muted playsInline />
                  {recording && <span className="proof-timer">{t('proof.secondsLeft', { seconds: secondsLeft })}</span>}
                  <button
                    type="button"
                    className="icon-btn proof-flip"
                    onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
                    disabled={recording}
                    aria-label={t('proof.flip')}
                  >
                    <Icon name="repeat" />
                  </button>
                  <button
                    type="button"
                    className={`proof-shutter ${mode === 'video' ? 'is-video' : ''} ${recording ? 'is-recording' : ''}`}
                    onClick={mode === 'photo' ? takePhoto : recording ? () => recorderRef.current?.stop() : startRecording}
                    aria-label={t(mode === 'photo' ? 'proof.takePhoto' : recording ? 'proof.stop' : 'proof.record')}
                  />
                </>
              )}
            </div>
          </>
        )}
        {sendError && <p className="callout callout-error" role="alert">{sendError}</p>}
      </div>
    </Sheet>
  );
}
