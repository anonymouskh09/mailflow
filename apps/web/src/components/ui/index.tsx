import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X, Loader2, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

// ---------- Button ----------
type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'md' | 'sm';
  icon?: boolean;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        size === 'md' ? 'h-10' : 'h-9',
        icon ? (size === 'md' ? 'w-10 px-0' : 'w-9 px-0') : 'px-3.5',
        variant === 'default' && 'bg-white border-line text-ink hover:bg-[#F4F4F5]',
        variant === 'primary' && 'bg-accent border-accent text-white hover:bg-[#4338CA]',
        variant === 'ghost' && 'bg-transparent border-transparent text-ink hover:bg-[#F4F4F5]',
        variant === 'danger' && 'bg-[#B91C1C] border-[#B91C1C] text-white hover:bg-[#991B1B]',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---------- Status pill ----------
const PILL: Record<string, [string, string, string]> = {
  active: ['#DCFCE7', '#166534', 'Active'],
  paused: ['#FEF3C7', '#92400E', 'Paused'],
  limit: ['#FEF3C7', '#92400E', 'Limit reached'],
  error: ['#FEE2E2', '#991B1B', 'Error'],
  draft: ['#EEF2FF', '#3730A3', 'Draft'],
  completed: ['#F4F4F5', '#3F3F46', 'Completed'],
  // lead states
  not_contacted: ['#F4F4F5', '#3F3F46', 'Not contacted'],
  in_sequence: ['#EEF2FF', '#3730A3', 'In sequence'],
  replied: ['#DCFCE7', '#166534', 'Replied'],
  bounced: ['#FEE2E2', '#991B1B', 'Bounced'],
  unsubscribed: ['#FEF3C7', '#92400E', 'Unsubscribed'],
};
export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  const [bg, fg, text] = PILL[status] ?? ['#F4F4F5', '#3F3F46', status];
  // account "paused" is grey in the accounts design
  return <Pill bg={bg} fg={fg} className={className}>{label ?? text}</Pill>;
}
export function Pill({ bg, fg, children, className }: { bg: string; fg: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', className)} style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}

// ---------- Switch ----------
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('flex h-6 w-10 flex-none cursor-pointer rounded-full border-0 p-0.5 transition-colors disabled:opacity-50', checked ? 'justify-end bg-accent' : 'justify-start bg-[#D4D4D8]')}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
    </button>
  );
}

// ---------- Popover / Menu ----------
function useOutside(open: boolean, close: () => void, refs: React.RefObject<HTMLElement>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

export function Popover({ trigger, children, align = 'right', width = 220, open: openProp, onOpenChange }: { trigger: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement> }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; width?: number; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOpenState(o));
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const close = useCallback(() => setOpen(false), [onOpenChange]);
  useOutside(open, close, [btn as any, panel as any]);
  useEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const left = align === 'right' ? r.right - width : r.left;
      const maxLeft = window.innerWidth - width - 8;
      setPos({ top: r.bottom + 6 + window.scrollY, left: Math.max(8, Math.min(left, maxLeft)) + window.scrollX });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, width]);
  return (
    <>
      {trigger({ open, toggle: () => setOpen(!open), ref: btn })}
      {open &&
        createPortal(
          <div ref={panel} className="card absolute z-50 p-1.5 shadow-[0_8px_24px_rgba(24,24,27,.12)]" style={{ top: pos.top, left: pos.left, width }}>
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface MenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  hidden?: boolean;
}
export function Menu({ items, label, size = 'md', ghost = false, trigger }: { items: MenuItem[]; label: string; size?: 'md' | 'sm'; ghost?: boolean; trigger?: ReactNode }) {
  const visible = items.filter((i) => !i.hidden);
  return (
    <Popover
      width={210}
      trigger={({ toggle, ref, open }) => (
        <Button ref={ref} icon={!trigger} size={size} variant={ghost ? 'ghost' : 'default'} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          {trigger ?? <MoreHorizontal className="h-4 w-4" aria-hidden />}
        </Button>
      )}
    >
      {(close) => (
        <div role="menu">
          {visible.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 h-px bg-soft" />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                className={cn('block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#F4F4F5] disabled:opacity-50', it.danger ? 'text-[#B91C1C]' : 'text-ink')}
                onClick={() => {
                  close();
                  it.onClick?.();
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </Popover>
  );
}

/** Select-like dropdown button. */
export function Dropdown<T extends string>({ value, options, onChange, label, className, renderValue }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string; renderValue?: (v: T) => ReactNode }) {
  const cur = options.find((o) => o.value === value);
  return (
    <Popover
      align="left"
      width={240}
      trigger={({ toggle, ref, open }) => (
        <Button ref={ref} className={className} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
          <span className="truncate">{renderValue ? renderValue(value) : (cur?.label ?? label)}</span>
          <ChevronDown className="h-3.5 w-3.5 flex-none" aria-hidden />
        </Button>
      )}
    >
      {(close) => (
        <div role="listbox" className="max-h-72 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[#F4F4F5]"
              onClick={() => {
                close();
                onChange(o.value);
              }}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check className="h-4 w-4 text-accent" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, description, children, footer, width = 600 }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,button:not([aria-label="Close"]),textarea,select')?.focus(), 0);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(24,24,27,.45)] px-4 py-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="flex w-full flex-col rounded-2xl bg-white shadow-[0_24px_64px_rgba(24,24,27,.25)]" style={{ maxWidth: width }}>
        <div className="flex items-start gap-3 px-6 pb-2 pt-6">
          <div className="flex-1">
            <h2 id={id} className="m-0 text-xl font-bold">
              {title}
            </h2>
            {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
          </div>
          <Button icon variant="ghost" aria-label="Close" onClick={onClose} className="text-muted">
            <X className="h-[18px] w-[18px]" aria-hidden />
          </Button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2.5 px-6 pb-6 pt-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Segmented tabs ----------
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex flex-wrap gap-0.5 self-start rounded-lg bg-[#EDEDF0] p-[3px]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('h-[34px] rounded-md border-0 px-3 text-[13px] font-medium', o.value === value ? 'bg-white text-ink shadow-[0_1px_2px_rgba(24,24,27,.08)]' : 'bg-transparent text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Misc ----------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-subtle', className)} aria-label="Loading" />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="lbl">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className={cn('h-4 w-4 cursor-pointer accent-accent', className)} />;
}

export function ProgressBar({ value, width = 90, color = '#4F46E5' }: { value: number; width?: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 rounded-sm bg-soft" style={{ width }}>
        <div className="h-1.5 rounded-sm" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
      <span className="text-xs text-muted">{Math.round(value)}%</span>
    </div>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cn('pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg', t.kind === 'ok' ? 'bg-ink text-white' : 'bg-[#991B1B] text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function SearchInput({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={cn('relative inline-flex', className)}>
      <span className="pointer-events-none absolute left-3 top-3 text-subtle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="inp w-full pl-9 sm:w-60" />
    </label>
  );
}
