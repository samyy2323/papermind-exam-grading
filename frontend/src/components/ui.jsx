// Small shared UI primitives. Larger components live in their own files.
import { Link } from 'react-router-dom';
import Icon from './Icon';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const BTN_VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-dark shadow-sm',
  secondary: 'bg-card text-ink border border-line hover:bg-paper-2',
  ghost: 'text-ink-soft hover:bg-paper-2 hover:text-ink',
  danger: 'bg-card text-bad border border-bad/30 hover:bg-bad-soft',
  ink: 'bg-ink text-paper hover:bg-ink/90',
};
const BTN_SIZES = { sm: 'text-sm px-3 py-1.5', md: 'text-sm px-4 py-2', lg: 'text-base px-5 py-2.5' };

export function Button({ variant = 'primary', size = 'md', to, icon, iconRight, loading, className = '', children, ...props }) {
  const cls = `${BTN_BASE} ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${className}`;
  const content = (
    <>
      {loading ? <Spinner size={16} /> : icon && <Icon name={icon} size={16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={16} />}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls} {...props}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} disabled={loading || props.disabled} {...props}>
      {content}
    </button>
  );
}

export function Card({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={`rounded-lg border border-line bg-card shadow-[0_1px_2px_rgba(27,36,56,0.04)] ${className}`} {...props}>
      {children}
    </Tag>
  );
}

const TONES = {
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/20',
  idle: 'bg-idle-soft text-idle border-idle/20',
  accent: 'bg-accent-soft text-accent border-accent/20',
  neutral: 'bg-paper-2 text-ink-soft border-line',
};

export function Badge({ tone = 'neutral', icon, className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {icon && <Icon name={icon} size={12} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

const STATUS = {
  graded: { tone: 'ok', label: 'Graded', icon: 'check' },
  needs_review: { tone: 'warn', label: 'Needs review', icon: 'alert' },
  processing: { tone: 'idle', label: 'Processing', icon: 'clock' },
  draft: { tone: 'neutral', label: 'Draft', icon: 'pencil' },
  published: { tone: 'accent', label: 'Published', icon: 'lock' },
  indexed: { tone: 'ok', label: 'Indexed', icon: 'check' },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] || { tone: 'neutral', label: status };
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

export function Spinner({ size = 20, className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ProgressBar({ value, label, tone = 'accent' }) {
  const color = tone === 'accent' ? 'bg-accent' : tone === 'ok' ? 'bg-ok' : 'bg-warn';
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex justify-between text-xs text-ink-soft">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(value)}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${color} transition-[width] duration-200`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-accent">
          <Icon name="arrowLeft" size={14} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold sm:text-[1.75rem]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line bg-card/60 px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-paper-2 text-ink-soft">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'bad', icon, children, className = '' }) {
  const t = { bad: 'bg-bad-soft text-bad border-bad/20', warn: 'bg-warn-soft text-warn border-warn/25', ok: 'bg-ok-soft text-ok border-ok/20', accent: 'bg-accent-soft text-accent border-accent/20' }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${t} ${className}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={icon || (tone === 'ok' ? 'check' : tone === 'accent' ? 'info' : 'alert')} size={16} className="mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Hover/focus tooltip. Wrap a focusable trigger.
export function Tooltip({ content, children, className = '' }) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs font-normal leading-snug text-paper opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}

export function MismatchWarning({ size = 16 }) {
  return (
    <Tooltip content="Low topical relevance despite high score — verify manually.">
      <span tabIndex={0} className="inline-flex cursor-help text-bad" aria-label="Low topical relevance despite high score — verify manually.">
        <Icon name="shield" size={size} strokeWidth={2} />
      </span>
    </Tooltip>
  );
}

export function Stat({ label, value, hint, tone }) {
  const color = tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-ink';
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-serif text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
    </Card>
  );
}
