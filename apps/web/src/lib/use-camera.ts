'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from './i18n';

// A live camera stream for a <video>, running only while `active`.
export function useCamera(facing: 'environment' | 'user', active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Sheet mounts its content a render late, so the stream can arrive before the video element.
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (video) video.srcObject = streamRef.current;
  }, []);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (!active) return;
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
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [facing, active]);

  return { videoRef, streamRef, attachVideo, cameraError };
}
