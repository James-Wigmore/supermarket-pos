import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { Page } from '../lib/types';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50',
  secondary: 'bg-white text-ink border border-line hover:bg-paper disabled:text-muted',
  danger: 'bg-danger text-white hover:opacity-90 disabled:opacity-50',
  ghost: 'text-ink hover:bg-ink/5 disabled:text-muted',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const Button = ({ variant = 'primary', loading, size = 'md', className, children, disabled, type = 'button', ...rest }: ButtonProps) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-2 rounded-field font-semibold transition-colors disabled:cursor-not-allowed',
      size === 'sm' && 'px-2.5 py-1 text-sm', size === 'md' && 'px-4 py-2 text-sm', size === 'lg' && 'px-6 py-3.5 text-base',
      VARIANTS[variant], className,
    )}
    {...rest}
  >
    {loading && <Spinner small />}
    {children}
  </button>
);

export const Spinner = ({ small }: { small?: boolean }) => (
  <span role="status" aria-label="Loading" className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'size-3.5' : 'size-6')} />
);

export const inputCls = 'w-full rounded-field border border-line bg-white px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand disabled:bg-paper';

interface FieldProps { label: string; error?: string; hint?: string; children: (id: string) => ReactNode; className?: string }
export const Field = ({ label, error, hint, children, className }: FieldProps) => {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
};

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, hint, className, ...rest }, ref) => (
  <Field label={label} error={error} hint={hint} className={className}>{(id) => <input id={id} ref={ref} className={inputCls} {...rest} />}</Field>
));
Input.displayName = 'Input';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string };
export const Select = ({ label, error, className, children, ...rest }: SelectProps) => (
  <Field label={label} error={error} className={className}>{(id) => <select id={id} className={inputCls} {...rest}>{children}</select>}</Field>
);

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string };
export const Textarea = ({ label, className, ...rest }: TextareaProps) => (
  <Field label={label} className={className}>{(id) => <textarea id={id} rows={3} className={inputCls} {...rest} />}</Field>
);

export const Panel = ({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={cx('rounded-panel border border-line bg-white', className)}>
    {(title || actions) && (
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        {actions}
      </header>
    )}
    <div className="p-4">{children}</div>
  </section>
);

export const PageHeader = ({ title, children, subtitle }: { title: string; subtitle?: string; children?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

const TONES = { neutral: 'bg-ink/8 text-ink', good: 'bg-brand-soft text-brand-dark', warn: 'bg-warn-soft text-warn', bad: 'bg-danger-soft text-danger' } as const;
export const Badge = ({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) => (
  <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', TONES[tone])}>{children}</span>
);

export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="px-4 py-12 text-center">
    <p className="font-semibold">{title}</p>
    {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Loading = () => (
  <div className="flex justify-center py-12 text-muted"><Spinner /></div>
);

export const ErrorNote = ({ error }: { error: unknown }) =>
  error ? <p role="alert" className="rounded-field bg-danger-soft px-3 py-2 text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p> : null;

interface Column<T> { header: string; cell: (row: T) => ReactNode; align?: 'right'; className?: string }
interface TableProps<T> { columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; empty?: ReactNode; rowKey: (row: T) => string; onRowClick?: (row: T) => void }

export const DataTable = <T,>({ columns, rows, loading, empty, rowKey, onRowClick }: TableProps<T>) => {
  if (loading) return <Loading />;
  if (!rows?.length) return <>{empty ?? <Empty title="Nothing here yet" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {columns.map((c) => <th key={c.header} className={cx('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick && (() => onRowClick(row))}
              className={cx('border-b border-line/60 last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-soft/50')}
            >
              {columns.map((c) => <td key={c.header} className={cx('px-3 py-2.5', c.align === 'right' && 'text-right', c.className)}>{c.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const Pagination = ({ meta, onPage }: { meta?: Page<unknown>['meta']; onPage: (page: number) => void }) =>
  meta && meta.totalPages > 1 ? (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-line px-3 py-2 text-sm">
      <span className="text-muted">Page {meta.page} of {meta.totalPages} · {meta.total} records</span>
      <span className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next</Button>
      </span>
    </nav>
  ) : null;

interface ModalProps { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: 'sm' | 'md' | 'lg' | 'xl'; footer?: ReactNode }
const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

export const Modal = ({ open, onClose, title, children, width = 'md', footer }: ModalProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx('m-auto w-[calc(100%-1.5rem)] rounded-panel p-0 shadow-2xl backdrop:bg-ink/50', WIDTHS[width])}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-xl leading-none text-muted hover:bg-ink/5">×</button>
          </header>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line bg-paper px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
};

export const Confirm = ({ open, title, message, confirmLabel, onConfirm, onCancel, danger, loading }: {
  open: boolean; title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; loading?: boolean;
}) => (
  <Modal open={open} onClose={onCancel} title={title} width="sm"
    footer={<><Button variant="secondary" onClick={onCancel}>Keep it</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
    <p className="text-sm">{message}</p>
  </Modal>
);

type ToastKind = 'success' | 'error';
interface Toast { id: number; kind: ToastKind; message: string }
const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx('rounded-field px-4 py-3 text-sm font-medium shadow-lg', t.kind === 'success' ? 'bg-brand text-white' : 'bg-danger text-white')}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const Stat = ({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' | 'bad' }) => (
  <div className="rounded-panel border border-line bg-white px-4 py-3">
    <p className="text-sm text-muted">{label}</p>
    <p className={cx('mt-0.5 text-2xl font-bold', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-danger')}>{value}</p>
    {hint && <p className="text-xs text-muted">{hint}</p>}
  </div>
);

export const Tabs = <T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) => (
  <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
    {tabs.map((t) => (
      <button key={t.id} role="tab" aria-selected={value === t.id} type="button" onClick={() => onChange(t.id)}
        className={cx('-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold', value === t.id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>{t.label}</button>
    ))}
  </div>
);
