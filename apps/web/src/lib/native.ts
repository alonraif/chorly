'use client';

import { api } from './api';

// The Android app (mobile/) loads this same site and exposes its native plugins on window.Capacitor.
// Null in a browser or installed web app, which keep using web push and the Geolocation API.
export function nativePlugins(): Record<string, any> | null {
  if (typeof window === 'undefined') return null;
  const plugins = (window as any).Capacitor?.Plugins;
  return plugins?.PushNotifications ? plugins : null;
}

// The push plugin crashes the app without Firebase config, so MainActivity only adds FirebaseReady
// to builds that include google-services.json. Without it the app simply has no notifications.
export function nativePush() {
  const plugins = nativePlugins();
  return plugins?.FirebaseReady ? plugins.PushNotifications : null;
}

// Android throttles requests made by the page after a few minutes in the background, so anything
// sent from there goes through native HTTP. It shares the page's login cookie.
export async function nativePost(path: string, body: unknown) {
  await nativePlugins()?.CapacitorHttp.post({
    url: `${window.location.origin}/api${path}`,
    headers: { 'Content-Type': 'application/json' },
    data: body,
  });
}

// Registers this device with Firebase and links it to the signed-in family member.
export async function registerNativePush(push: any) {
  const listeners: any[] = [];
  try {
    const token = new Promise<string>((resolve, reject) => {
      listeners.push(push.addListener('registration', (result: { value: string }) => resolve(result.value)));
      listeners.push(push.addListener('registrationError', (result: { error: string }) => reject(new Error(result.error))));
    });
    await push.register();
    await api.post('/push/fcm', { token: await token });
  } finally {
    await Promise.all(listeners.map(async (listener) => (await listener).remove()));
  }
}
