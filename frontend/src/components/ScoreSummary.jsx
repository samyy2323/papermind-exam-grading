import { Card, Badge } from './ui';
import ReferencePdfLink from './ReferencePdfLink';
import { summarizeSubmission, formatDateTime, needsReview, effectiveScore } from '../utils/grading';

export default function ScoreSummary({ exam, submission, mode = 'student' }) {
  const s = summarizeSubmission(submission, exam);
  // Students don't see AI marks for answers still under review, so exclude them from their total.
  const hidden =
    mode === 'student'
      ? submission.answers.reduce((t, a) => {
          const q = exam.questions.find((qq) => qq.id === a.questionId);
          return q && needsReview(a, q) ? t + effectiveScore(a) : t;
        }, 0)
      : 0;
  const total = s.total - hidden;
  const pct = Math.round((total / s.max) * 100);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            {s.pending > 0 ? (mode === 'student' ? 'Score so far' : 'Provisional score') : 'Total score'}
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-serif">
            <span className="text-5xl font-semibold tabular-nums text-ink sm:text-6xl">{total}</span>
            <span className="text-2xl text-muted">/ {s.max}</span>
            <span className="ml-2 font-sans text-sm font-medium text-ink-soft">{pct}%</span>
          </div>
          {s.pending > 0 && (
            <p className="mt-2 max-w-md text-sm text-warn">
              {mode === 'student'
                ? `${s.pending} ${s.pending === 1 ? 'answer is' : 'answers are'} pending teacher review — your score may change.`
                : `${s.pending} ${s.pending === 1 ? 'answer needs' : 'answers need'} your review before results are final.`}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
          {mode === 'teacher' && (
            <>
              <dt className="text-muted">Student</dt>
              <dd className="font-medium">
                {submission.studentName} <span className="text-muted">({submission.usn})</span>
              </dd>
            </>
          )}
          <dt className="text-muted">Submitted</dt>
          <dd>{formatDateTime(submission.submittedAt)}</dd>
          <dt className="text-muted">Pages</dt>
          <dd className="flex items-center gap-2 sm:justify-end">
            {submission.pages}
            <ReferencePdfLink submissionId={submission.id} label />
          </dd>
          <dt className="text-muted">Status</dt>
          <dd>
            {s.pending > 0 ? (
              <Badge tone="warn" icon="clock">
                {mode === 'student' ? 'Under review' : 'Needs review'}
              </Badge>
            ) : (
              <Badge tone="ok" icon="check">
                Final
              </Badge>
            )}
          </dd>
        </dl>
      </div>
      <div className="h-1.5 bg-paper-2">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}
