'use client';

import { guessShoppingCategory, shoppingKey, splitShoppingText, type ShoppingCategory, type ShoppingUpdate } from '@chorly/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useAutoRefresh } from './refresh';

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: string | null;
  note: string | null;
  category: ShoppingCategory;
  state: 'needed' | 'bought' | 'removed';
  urgent: boolean;
  addedById: string | null;
  addedAt: string;
  boughtById: string | null;
  boughtAt: string | null;
};

type ShoppingData = {
  items: ShoppingItem[];
  known: Array<{ name: string; category: ShoppingCategory }>;
  buyAgain: string[];
  shopperIds: string[];
};

// A change the server hasn't confirmed. Waiting ones survive a closed app, so a store with no signal loses nothing.
type Op =
  | { kind: 'add'; id: string; name: string; category: ShoppingCategory; userId: string; at: string }
  | { kind: 'buy' | 'unbuy' | 'remove'; id: string; userId: string; at: string }
  | { kind: 'update'; id: string; patch: ShoppingUpdate };

const REFRESH_MS = 5_000;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the list still works, it just doesn't survive closing the app.
  }
}

function applyOp(items: ShoppingItem[], op: Op): ShoppingItem[] {
  switch (op.kind) {
    case 'add': {
      const key = shoppingKey(op.name);
      const reopened = { state: 'needed', quantity: null, urgent: false, addedById: op.userId, addedAt: op.at, boughtById: null, boughtAt: null } as const;
      if (items.some((item) => shoppingKey(item.name) === key)) {
        return items.map((item) => (shoppingKey(item.name) === key ? { ...item, ...reopened, name: op.name } : item));
      }
      return [...items, { ...reopened, id: op.id, name: op.name, note: null, category: op.category }];
    }
    case 'buy':
      return items.map((item) => (item.id === op.id ? { ...item, state: 'bought', boughtById: op.userId, boughtAt: op.at } : item));
    case 'unbuy':
      return items.map((item) => (item.id === op.id ? { ...item, state: 'needed', boughtById: null, boughtAt: null } : item));
    case 'remove':
      return items.filter((item) => item.id !== op.id);
    case 'update':
      return items.map((item) => (item.id === op.id ? { ...item, ...op.patch } : item));
  }
}

// Returns the item's id on the server, which an offline add only learns now.
async function send(op: Op): Promise<string> {
  switch (op.kind) {
    case 'add':
      return (await api.post('/shopping/items', { name: op.name })).item.id;
    case 'buy':
    case 'unbuy':
      await api.post(`/shopping/items/${op.id}/${op.kind}`);
      return op.id;
    case 'remove':
      await api.delete(`/shopping/items/${op.id}`);
      return op.id;
    case 'update':
      await api.patch(`/shopping/items/${op.id}`, op.patch);
      return op.id;
  }
}

// A refusal won't change on a retry, while no answer or a server hiccup might.
function worthRetrying(err: unknown) {
  return !(err instanceof ApiError) || err.status >= 500 || err.status === 408 || err.status === 429;
}

export function useShoppingList(userId: string, onRefused: (err: Error) => void) {
  const dataKey = `chorly.shopping.${userId}`;
  const queueKey = `chorly.shopping.queue.${userId}`;
  const [data, setData] = useState<ShoppingData | null>(() => readStored<ShoppingData | null>(dataKey, null));
  const [ops, setOps] = useState<Op[]>(() => readStored<Op[]>(queueKey, []));
  const [offline, setOffline] = useState(false);
  const queue = useRef(ops);
  const flushing = useRef(false);
  // Moves on with every change, so a list fetched before it can't overwrite the newer picture.
  const generation = useRef(0);
  const serverIds = useRef(new Map<string, string>());
  const refused = useRef(onRefused);
  refused.current = onRefused;

  const setQueue = useCallback(
    (next: Op[]) => {
      queue.current = next;
      generation.current += 1;
      setOps(next);
      store(queueKey, next);
    },
    [queueKey],
  );

  // Sends waiting changes in order. False when the connection gave out, and the rest wait for the next try.
  const flush = useCallback(async () => {
    if (flushing.current) return true;
    flushing.current = true;
    try {
      while (queue.current.length > 0) {
        const op = queue.current[0];
        try {
          const id = await send(op);
          serverIds.current.set(op.id, id);
          setData((current) => current && { ...current, items: applyOp(current.items, op).map((item) => (item.id === op.id ? { ...item, id } : item)) });
          setQueue(queue.current.slice(1).map((next) => (next.id === op.id ? { ...next, id } : next)));
          setOffline(false);
        } catch (err) {
          if (worthRetrying(err)) {
            setOffline(true);
            return false;
          }
          setQueue(queue.current.slice(1));
          // Someone else got to it first, which needs no apology.
          if (!(err instanceof ApiError && err.status === 404)) refused.current(err as Error);
        }
      }
      return true;
    } finally {
      flushing.current = false;
    }
  }, [setQueue]);

  const load = useCallback(async () => {
    if (!(await flush())) return;
    const started = generation.current;
    try {
      const next = (await api.get('/shopping')) as ShoppingData;
      setOffline(false);
      if (started !== generation.current || queue.current.length > 0) return;
      setData(next);
      store(dataKey, next);
    } catch {
      setOffline(true);
    }
  }, [flush, dataKey]);

  useAutoRefresh(load, REFRESH_MS);
  useEffect(() => {
    load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [load]);

  const items = useMemo(() => ops.reduce(applyOp, data?.items ?? []), [data, ops]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const enqueue = useCallback(
    (added: Op[]) => {
      setQueue([...queue.current, ...added]);
      load();
    },
    [load, setQueue],
  );

  const stamp = useCallback(() => ({ userId, at: new Date().toISOString() }), [userId]);
  const serverId = (id: string) => serverIds.current.get(id) ?? id;

  // Returns the names that were on the list already.
  const add = useCallback(
    (text: string) => {
      const known = new Map((data?.known ?? []).map((k) => [shoppingKey(k.name), k.category]));
      const needed = new Set(itemsRef.current.filter((item) => item.state === 'needed').map((item) => shoppingKey(item.name)));
      const already: string[] = [];
      const added: Op[] = [];
      for (const name of splitShoppingText(text)) {
        const key = shoppingKey(name);
        if (needed.has(key)) {
          already.push(name);
          continue;
        }
        needed.add(key);
        added.push({ kind: 'add', id: `local-${crypto.randomUUID()}`, name, category: known.get(key) ?? guessShoppingCategory(name), ...stamp() });
      }
      if (added.length > 0) enqueue(added);
      return already;
    },
    [data, enqueue, stamp],
  );

  const buy = useCallback((id: string) => enqueue([{ kind: 'buy', id: serverId(id), ...stamp() }]), [enqueue, stamp]);
  const unbuy = useCallback((id: string) => enqueue([{ kind: 'unbuy', id: serverId(id), ...stamp() }]), [enqueue, stamp]);
  const remove = useCallback((id: string) => enqueue([{ kind: 'remove', id: serverId(id), ...stamp() }]), [enqueue, stamp]);
  const update = useCallback((id: string, patch: ShoppingUpdate) => enqueue([{ kind: 'update', id: serverId(id), patch }]), [enqueue]);

  return {
    loaded: data !== null,
    offline,
    waiting: ops.length,
    items,
    known: data?.known ?? [],
    buyAgain: data?.buyAgain ?? [],
    shopperIds: data?.shopperIds ?? [],
    add,
    buy,
    unbuy,
    remove,
    update,
    reload: load,
  };
}
