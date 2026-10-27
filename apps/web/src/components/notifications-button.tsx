'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type State = 'unsupported' | 'ios-install' | 'off' | 'on' | 'denied' | 'working';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function NotificationsButton() {
  const [state, setState] = useState<State>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    currentSubscription()
      .then(async (sub) => {
        if (sub && Notification.permission === 'granted') {
          // Re-register in case this device was removed server-side or a different family member logged in.
          await api.post('/push/subscribe', sub.toJSON());
          setState('on');
        } else {
          setState('off');
        }
      })
      .catch(() => setState('off'));
  }, []);

  async function enable() {
    setError('');
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const { publicKey } = await api.get('/push/public-key');
      if (!publicKey) throw new Error('Push is not configured on the server');
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await api.post('/push/subscribe', sub.toJSON());
      await api.post('/push/test');
      setState('on');
    } catch (err: any) {
      setError(err.message || 'Could not enable notifications');
      setState('off');
    }
  }

  if (state === 'unsupported' || state === 'on' || state === 'working') return null;
  if (state === 'ios-install') {
    return <small className="task-meta">To get notifications: Share → Add to Home Screen, then open Chorly from the icon.</small>;
  }
  if (state === 'denied') {
    return <small className="task-meta">Notifications are blocked in this browser's settings.</small>;
  }
  return (
    <>
      <button type="button" className="ghost-button" onClick={enable}>🔔 Turn on notifications</button>
      {error && <small className="error">{error}</small>}
    </>
  );
}
