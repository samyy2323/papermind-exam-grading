import Icon from './Icon';
import { Spinner } from './ui';

/**
 * steps: [{ key, label, description }]
 * current: index of the active step; steps before it are complete.
 * If current === steps.length - 1 and `complete` is true, the final step shows as done.
 */
export default function StepIndicator({ steps, current, complete = false }) {
  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-start">
      {steps.map((step, i) => {
        const done = i < current || (complete && i === current);
        const active = i === current && !complete;
        return (
          <li key={step.key} className="relative flex flex-1 gap-3 pb-6 sm:flex-col sm:items-center sm:pb-0 sm:text-center">
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 sm:left-[calc(50%+20px)] sm:top-[15px] sm:h-0.5 sm:w-[calc(100%-40px)]
                  ${i < current ? 'bg-accent' : 'bg-line'}`}
              />
            )}
            <span
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold
                ${done ? 'border-accent bg-accent text-white' : active ? 'border-accent bg-card text-accent' : 'border-line bg-card text-muted'}`}
            >
              {done ? <Icon name="check" size={16} strokeWidth={2.5} /> : active ? <Spinner size={16} /> : i + 1}
            </span>
            <div className="sm:mt-2 sm:px-2">
              <div className={`text-sm font-medium ${done || active ? 'text-ink' : 'text-muted'}`}>{step.label}</div>
              {step.description && <div className="mt-0.5 text-xs text-ink-soft">{step.description}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
