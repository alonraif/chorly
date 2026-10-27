'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';
import { Icon, type IconName } from './icon';

// ---- Sheet: bottom sheet on phones, centered dialog on wider screens ----

let openSheets = 0;

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the top-most sheet reacts when sheets are stacked (e.g. a confirm over an editor).
      const backdrops = document.querySelectorAll('.sheet-backdrop');
      if (backdrops[backdrops.length - 1] === panelRef.current?.parentElement) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    openSheets += 1;
    document.body.classList.add('no-scroll');
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not(.sheet-close)');
    (first || panelRef.current)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (openSheets === 0) document.body.classList.remove('no-scroll');
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={`sheet sheet-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <h2 id={titleId} className="sheet-title">{title}</h2>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---- Toasts and confirmations ----

type Tone = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; tone: Tone };
type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; danger?: boolean };

type UiContextValue = {
  toast: (message: string, tone?: Tone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const toast = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const settle = useCallback(
    (value: boolean) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );

  const icons: Record<Tone, IconName> = { success: 'check', error: 'alert', info: 'bell' };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      {mounted &&
        createPortal(
          <div className="toast-region" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast-${t.tone}`}>
                <Icon name={icons[t.tone]} size={18} />
                <span>{t.message}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
      <Sheet
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.title}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => settle(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={`btn ${pending?.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => settle(true)}
              data-autofocus
            >
              {pending?.confirmLabel || t('common.confirm')}
            </button>
          </>
        }
      >
        {pending?.body && <p className="muted">{pending.body}</p>}
      </Sheet>
    </UiContext.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}

// ---- Small building blocks ----

export function EmptyState({
  icon = 'sparkle',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={value === opt.value ? 'is-active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label={t('common.loading')} />;
}

export function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
