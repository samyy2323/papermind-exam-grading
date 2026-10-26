import { useState } from 'react';
import Icon from './Icon';
import { Badge, Button, MismatchWarning, Alert } from './ui';
import { answerFlags, effectiveScore, needsReview, CONFIDENCE_THRESHOLD, formatDateTime } from '../utils/grading';

/**
 * Per-question result list shared by the student results page and the teacher review page.
 * mode: 'student' (read-only, hides scores pending review) | 'teacher' (shows signals, allows override)
 */
export default function QuestionBreakdown({ exam, submission, mode = 'student', onOverride, onMarkReviewed }) {
  const answersById = Object.fromEntries(submission.answers.map((a) => [a.questionId, a]));
  const initiallyOpen =
    mode === 'teacher'
      ? exam.questions.filter((q) => answersById[q.id] && needsReview(answersById[q.id], q)).map((q) => q.id)
      : [];
  const [open, setOpen] = useState(() => new Set(initiallyOpen));

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOpen = open.size === exam.questions.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Question breakdown</h2>
        <button
          type="button"
          className="text-sm font-medium text-accent hover:underline"
          onClick={() => setOpen(allOpen ? new Set() : new Set(exam.questions.map((q) => q.id)))}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
        {exam.questions.map((q) => {
          const ans = answersById[q.id];
          if (!ans) return null;
          return (
            <QuestionRow
              key={q.id}
              question={q}
              answer={ans}
              mode={mode}
              expanded={open.has(q.id)}
              onToggle={() => toggle(q.id)}
              onOverride={onOverride}
              onMarkReviewed={onMarkReviewed}
            />
          );
        })}
      </ul>
    </div>
  );
}

function QuestionRow({ question: q, answer: a, mode, expanded, onToggle, onOverride, onMarkReviewed }) {
  const pending = needsReview(a, q);
  const flags = answerFlags(a, q);
  const score = effectiveScore(a);
  const objective = q.type === 'objective';
  const correct = objective ? (a.override ? score === q.marks : a.correct) : null;
  const panelId = `q-panel-${q.id}`;

  return (
    <li className={pending ? 'bg-warn-soft/30' : ''}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-paper/70 sm:items-center"
      >
        <span className="mt-0.5 flex h-7 w-9 shrink-0 items-center justify-center rounded bg-paper-2 font-serif text-sm font-semibold text-ink sm:mt-0">
          Q{q.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm text-ink ${expanded ? 'whitespace-pre-line' : 'line-clamp-2 sm:line-clamp-1'}`}>
            {q.text}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{objective ? 'Objective' : 'Subjective'}</Badge>
            {mode === 'teacher' && pending && flags.answerNotFound && (
              <Badge tone="warn" icon="alert">
                Answer not found
              </Badge>
            )}
            {mode === 'teacher' && pending && flags.segmentationUncertain && (
              <Badge tone="warn" icon="alert">
                Segmentation uncertain
              </Badge>
            )}
            {mode === 'teacher' && pending && flags.lowConfidence && !flags.answerNotFound && (
              <Badge tone="warn" icon="alert">
                Low confidence {typeof a.confidence === 'number' ? a.confidence.toFixed(2) : ''}
              </Badge>
            )}
            {mode === 'teacher' && pending && flags.relevanceMismatch && (
              <Badge tone="bad" icon="shield">
                Relevance mismatch
              </Badge>
            )}
            {a.override && <Badge tone="accent" icon="pencil">Teacher adjusted</Badge>}
            {mode === 'teacher' && a.reviewed && !a.override && <Badge tone="ok" icon="check">Reviewed</Badge>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {mode === 'teacher' && pending && flags.relevanceMismatch && <MismatchWarning />}
          <ScoreCell pending={pending} mode={mode} score={score} max={q.marks} objective={objective} correct={correct} />
          <Icon name="chevronDown" size={18} className={`text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-line/70 bg-paper/40 px-4 pb-5 pt-4 sm:pl-16">
          <div className="grid gap-4 lg:grid-cols-2">
            <AnswerBlock label="Student answer (extracted from handwriting)" tone="student">
              {a.ocrText || <span className="italic text-muted">No text detected.</span>}
            </AnswerBlock>
            <AnswerBlock label="Reference answer">{q.referenceAnswer}</AnswerBlock>
          </div>

          {objective ? (
            <div className={`mt-4 flex items-center gap-2 text-sm font-medium ${correct ? 'text-ok' : 'text-bad'}`}>
              <Icon name={correct ? 'check' : 'x'} size={18} strokeWidth={2.4} />
              {correct ? 'Matches the answer key' : 'Does not match the answer key'}
            </div>
          ) : (
            a.justification &&
            (mode === 'teacher' || !pending) && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  AI grading justification {a.override && '(original)'}
                </div>
                <p className="text-sm leading-relaxed text-ink-soft">{a.justification}</p>
              </div>
            )
          )}

          {mode === 'student' && pending && (
            <Alert tone="warn" icon="clock" className="mt-4">
              Your teacher is reviewing this answer. The final mark will appear here once the review is complete.
            </Alert>
          )}

          {a.override && (
            <div className="mt-4 rounded-md border border-accent/20 bg-accent-soft/60 px-3 py-2.5 text-sm">
              <div className="font-medium text-accent">
                Score adjusted to {a.override.score} / {q.marks}
                {mode === 'teacher' && <> (AI awarded {a.aiScore})</>}
              </div>
              <div className="mt-0.5 text-ink-soft">
                “{a.override.reason}” — {a.override.by}, {formatDateTime(a.override.at)}
              </div>
            </div>
          )}

          {mode === 'teacher' && (
            <TeacherControls question={q} answer={a} pending={pending} flags={flags} onOverride={onOverride} onMarkReviewed={onMarkReviewed} />
          )}
        </div>
      )}
    </li>
  );
}

function ScoreCell({ pending, mode, score, max, objective, correct }) {
  if (pending && mode === 'student') {
    return (
      <Badge tone="warn" icon="clock">
        Pending teacher review
      </Badge>
    );
  }
  const ratio = score / max;
  const color = ratio >= 0.7 ? 'text-ok' : ratio >= 0.4 ? 'text-ink' : 'text-bad';
  return (
    <span className="flex items-center gap-1.5">
      {objective && (
        <span className={correct ? 'text-ok' : 'text-bad'}>
          <Icon name={correct ? 'check' : 'x'} size={16} strokeWidth={2.6} title={correct ? 'Correct' : 'Incorrect'} />
        </span>
      )}
      <span className={`font-serif text-base font-semibold tabular-nums ${color}`}>
        {score}
        <span className="text-sm font-normal text-muted"> / {max}</span>
      </span>
    </span>
  );
}

function AnswerBlock({ label, tone, children }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`rounded-md border px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
          tone === 'student' ? 'border-line bg-card font-serif text-[0.95rem] text-ink' : 'border-line/70 bg-paper-2/60 text-ink-soft'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Meter({ label, value, threshold, invert }) {
  const pct = Math.round(value * 100);
  const low = value < threshold;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between text-xs">
        <span className="text-ink-soft">{label}</span>
        <span className={`tabular-nums font-medium ${low && !invert ? 'text-warn' : low ? 'text-bad' : 'text-ink'}`}>{pct}%</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-paper-2">
        <div className={`h-full rounded-full ${low ? (invert ? 'bg-bad' : 'bg-warn') : 'bg-ink-soft/60'}`} style={{ width: `${pct}%` }} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-ink/40" style={{ left: `${threshold * 100}%` }} title={`Threshold ${threshold}`} />
      </div>
    </div>
  );
}

function TeacherControls({ question: q, answer: a, pending, flags, onOverride, onMarkReviewed }) {
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState(String(effectiveScore(a)));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const n = Number(score);
    if (score === '' || Number.isNaN(n) || n < 0 || n > q.marks) return setError(`Enter a score between 0 and ${q.marks}.`);
    if (!reason.trim()) return setError('Please give a short reason for the override.');
    setSaving(true);
    setError('');
    try {
      await onOverride(q.id, n, reason);
      setEditing(false);
      setReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5 rounded-md border border-line bg-card p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        <Meter label="LLM confidence" value={a.confidence} threshold={CONFIDENCE_THRESHOLD} />
        {q.type === 'subjective' && <Meter label="Relevance to the reference answer" value={a.relevance} threshold={0.35} invert />}
      </div>
      {flags.relevanceMismatch && pending && (
        <Alert tone="bad" icon="shield" className="mt-3">
          <strong>Low topical relevance despite high score — verify manually.</strong> The answer is far from the reference
          answer but received {a.aiScore}/{q.marks}. This pattern is typical of prompt-injection or keyword-stuffed answers.
        </Alert>
      )}

      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
            Override score
          </Button>
          {pending && (
            <Button size="sm" variant="ghost" icon="check" onClick={() => onMarkReviewed(q.id)}>
              Accept AI score ({a.aiScore}/{q.marks})
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div>
            <label className="field-label" htmlFor={`score-${q.id}`}>
              New score
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={`score-${q.id}`}
                type="number"
                min={0}
                max={q.marks}
                step={0.5}
                className="field tabular-nums"
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
              <span className="text-sm text-muted">/{q.marks}</span>
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor={`reason-${q.id}`}>
              Reason <span className="text-bad">*</span>
            </label>
            <input
              id={`reason-${q.id}`}
              className="field"
              placeholder="e.g. Answer contains an instruction to the grader, not content."
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-bad sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" type="submit" loading={saving}>
              Save override
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setError(''); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
