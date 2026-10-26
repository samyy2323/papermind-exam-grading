import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAnalytics, getExams } from '../../api';
import useAsync from '../../utils/useAsync';
import ExamPicker from '../../components/ExamPicker';
import Icon from '../../components/Icon';
import { Alert, Button, Card, EmptyState, Loading, PageHeader, Stat } from '../../components/ui';

const INK_SOFT = '#465066';
const GRID = '#e4dccb';
const ACCENT = '#1f6f6b';

export default function Analytics() {
  const { data: allExams, loading, error } = useAsync(getExams);
  const exams = useMemo(() => (allExams || []).filter((e) => e.status === 'published'), [allExams]);
  const [params, setParams] = useSearchParams();
  const examId = params.get('exam') || exams[0]?.id;

  return (
    <>
      <PageHeader title="Class analytics" subtitle="How the class performed, and how much of the grading still needs a human look." />
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {allExams && exams.length === 0 && (
        <EmptyState icon="chart" title="No data to analyse yet" action={<Button to="/teacher/exams">Go to exams</Button>}>
          Analytics appear once an exam is published and students have submitted answer sheets.
        </EmptyState>
      )}
      {examId && (
        <>
          <div className="mb-6">
            <ExamPicker exams={exams} value={examId} onChange={(v) => setParams({ exam: v }, { replace: true })} />
          </div>
          <ExamAnalytics key={examId} examId={examId} />
        </>
      )}
    </>
  );
}

function ExamAnalytics({ examId }) {
  const { data: a, loading, error } = useAsync(() => getAnalytics(examId), [examId]);
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;

  const graded = a.flaggedSubmissions + a.cleanSubmissions;
  if (graded === 0) {
    return (
      <EmptyState icon="inbox" title="No graded submissions yet">
        {a.processing > 0 ? `${a.processing} answer ${a.processing === 1 ? 'sheet is' : 'sheets are'} still processing.` : 'Share the exam code with students to start collecting answer sheets.'}
      </EmptyState>
    );
  }

  const flaggedPct = (a.flaggedSubmissions / graded) * 100;
  const hist = a.distribution.map((b) => ({ ...b, label: `${b.lo}` }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Submissions" value={a.totalSubmissions} hint={a.processing ? `${graded} graded · ${a.processing} processing` : 'All graded'} />
        <Stat label="Average score" value={`${a.averageScore.toFixed(1)}`} hint={`out of ${a.exam.totalMarks} · ${a.averagePct.toFixed(0)}%`} />
        <Stat label="Median" value={`${a.medianPct.toFixed(0)}%`} hint={`Highest ${a.highestPct.toFixed(0)}%`} />
        <Stat label="Needs review" value={a.flaggedSubmissions} tone={a.flaggedSubmissions ? 'warn' : 'ok'} hint={`${flaggedPct.toFixed(0)}% of graded scripts`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-lg font-semibold">Score distribution</h2>
          <p className="mb-4 text-sm text-ink-soft">Number of students in each 10% band (provisional scores included).</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_SOFT, fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: INK_SOFT, fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'rgba(27,36,56,0.05)' }} content={<HistTooltip />} />
                <Bar dataKey="count" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Flagged vs clean</h2>
          <p className="mb-5 text-sm text-ink-soft">Graded scripts with at least one answer awaiting review.</p>
          <div className="flex h-4 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${a.flaggedSubmissions} flagged, ${a.cleanSubmissions} clean`}>
            {a.flaggedSubmissions > 0 && <div className="bg-warn" style={{ width: `${flaggedPct}%` }} />}
            {a.cleanSubmissions > 0 && <div className="flex-1 bg-ok" />}
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <LegendRow icon="alert" color="text-warn" swatch="bg-warn" label="Needs review" value={a.flaggedSubmissions} />
            <LegendRow icon="check" color="text-ok" swatch="bg-ok" label="Clean" value={a.cleanSubmissions} />
          </dl>
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Flagged answers by reason</div>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-ink-soft"><Icon name="alert" size={14} className="text-warn" /> Low LLM confidence (&lt; 0.6)</dt>
                <dd className="font-medium tabular-nums">{a.flaggedAnswers.lowConfidence}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-ink-soft"><Icon name="shield" size={14} className="text-bad" /> Relevance mismatch</dt>
                <dd className="font-medium tabular-nums">{a.flaggedAnswers.mismatch}</dd>
              </div>
            </dl>
          </div>
          {a.flaggedSubmissions > 0 && (
            <Button size="sm" variant="secondary" className="mt-5 w-full" to={`/teacher/review?exam=${examId}&tab=review`} iconRight="arrowRight">
              Open review queue
            </Button>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Average by question</h2>
        <p className="mb-4 text-sm text-ink-soft">Mean score as a percentage of marks available — low bars point to topics worth revisiting.</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.perQuestion} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="question" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: INK_SOFT, fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: INK_SOFT, fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip cursor={{ fill: 'rgba(27,36,56,0.05)' }} content={<QuestionTooltip />} />
              <Bar dataKey="avgPct" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-accent">Show as table</summary>
          <table className="mt-3 w-full max-w-lg">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Question</th><th className="py-2">Type</th><th className="py-2 text-right">Avg</th><th className="py-2 text-right">%</th><th className="py-2 text-right">Flagged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {a.perQuestion.map((q) => (
                <tr key={q.question}>
                  <td className="py-2 font-medium">{q.question}</td>
                  <td className="py-2 capitalize text-ink-soft">{q.type}</td>
                  <td className="py-2 text-right tabular-nums">{q.avg} / {q.marks}</td>
                  <td className="py-2 text-right tabular-nums">{q.avgPct}%</td>
                  <td className="py-2 text-right tabular-nums">{q.flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>
    </div>
  );
}

function LegendRow({ icon, color, swatch, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-ink-soft">
        <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />
        <Icon name={icon} size={14} className={color} />
        {label}
      </dt>
      <dd className="font-serif text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function TipBox({ children }) {
  return <div className="rounded-md border border-line bg-card px-3 py-2 text-xs shadow-md">{children}</div>;
}

function HistTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipBox>
      <div className="font-medium text-ink">{d.range}</div>
      <div className="text-ink-soft">{d.count} {d.count === 1 ? 'student' : 'students'}</div>
    </TipBox>
  );
}

function QuestionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipBox>
      <div className="font-medium text-ink">{d.question} <span className="font-normal capitalize text-muted">· {d.type}</span></div>
      <div className="text-ink-soft">Average {d.avg} / {d.marks} ({d.avgPct}%)</div>
      {d.flagged > 0 && <div className="text-warn">{d.flagged} pending review</div>}
    </TipBox>
  );
}
