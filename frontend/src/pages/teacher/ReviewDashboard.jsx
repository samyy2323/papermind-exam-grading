import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getExams, getSubmissions } from '../../api';
import useAsync from '../../utils/useAsync';
import { formatDateTime } from '../../utils/grading';
import ExamPicker from '../../components/ExamPicker';
import Icon from '../../components/Icon';
import ReferencePdfLink from '../../components/ReferencePdfLink';
import { Alert, Badge, Button, Card, EmptyState, Loading, MismatchWarning, PageHeader, StatusBadge } from '../../components/ui';

const STATUS_ORDER = { needs_review: 0, processing: 1, graded: 2 };

export default function ReviewDashboard() {
  const { data: allExams, loading, error } = useAsync(getExams);
  const exams = useMemo(() => (allExams || []).filter((e) => e.status === 'published'), [allExams]);
  const [params, setParams] = useSearchParams();
  const examId = params.get('exam') || exams[0]?.id;
  const tab = params.get('tab') === 'review' ? 'review' : 'all';

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Review dashboard" subtitle="Every submission for an exam, with anything the AI was unsure about surfaced for you." />
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {allExams && exams.length === 0 && (
        <EmptyState icon="clipboard" title="No published exams" action={<Button to="/teacher/exams" icon="exam">Go to exams</Button>}>
          Publish an exam, then upload each student’s answer sheet; the graded scripts will appear here.
        </EmptyState>
      )}
      {examId && (
        <>
          <div className="mb-5">
            <ExamPicker exams={exams} value={examId} onChange={(v) => setParam('exam', v)} />
          </div>
          <SubmissionsTable key={examId} examId={examId} tab={tab} onTab={(t) => setParam('tab', t)} />
        </>
      )}
    </>
  );
}

function SubmissionsTable({ examId, tab, onTab }) {
  const navigate = useNavigate();
  const { data: rows, loading, error, reload } = useAsync(() => getSubmissions(examId), [examId]);
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' });

  const reviewCount = rows?.filter((r) => r.status === 'needs_review').length ?? 0;
  const mismatchCount = rows?.filter((r) => r.mismatch && r.status === 'needs_review').length ?? 0;

  const sorted = useMemo(() => {
    if (!rows) return [];
    const list = tab === 'review' ? rows.filter((r) => r.status === 'needs_review') : [...rows];
    const val = (r) => {
      switch (sort.key) {
        case 'name': return r.studentName.toLowerCase();
        case 'submitted': return r.submittedAt;
        case 'score': return r.total == null ? -1 : r.total / r.max;
        default: return STATUS_ORDER[r.status] * 1000 - (r.mismatch ? 1 : 0);
      }
    };
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
    return list;
  }, [rows, tab, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'score' || key === 'submitted' ? 'desc' : 'asc' }));

  if (loading && !rows) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!rows.length) {
    return (
      <EmptyState icon="inbox" title="No submissions yet" action={<Button variant="secondary" to={`/teacher/exams/${examId}/sheets`} icon="upload">Upload answer sheets</Button>}>
        Once you upload students’ answer sheets for this exam, they’ll be graded and listed here.
      </EmptyState>
    );
  }

  const tabCls = (active) =>
    `inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${active ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <div className="flex" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tabCls(tab === 'all')} onClick={() => onTab('all')}>
            All submissions <span className="rounded-full bg-paper-2 px-2 text-xs tabular-nums">{rows.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'review'} className={tabCls(tab === 'review')} onClick={() => onTab('review')}>
            Needs review
            <span className={`rounded-full px-2 text-xs font-semibold tabular-nums ${reviewCount ? 'bg-warn text-white' : 'bg-paper-2'}`}>{reviewCount}</span>
          </button>
        </div>
        <button type="button" onClick={() => reload()} className="mb-2 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      {tab === 'review' && mismatchCount > 0 && (
        <Alert tone="bad" icon="shield" className="mb-4">
          {mismatchCount} {mismatchCount === 1 ? 'submission has' : 'submissions have'} an answer with low topical relevance despite a high
          score — a common signature of prompt injection or keyword stuffing. Verify these first.
        </Alert>
      )}

      {sorted.length === 0 ? (
        <EmptyState icon="check" title="Nothing needs review" action={<Button variant="secondary" onClick={() => onTab('all')}>View all submissions</Button>}>
          Every AI-assigned score for this exam is above the confidence threshold or has already been checked.
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line bg-paper-2/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <SortTh label="Student" k="name" sort={sort} onSort={toggleSort} />
                <SortTh label="Submitted" k="submitted" sort={sort} onSort={toggleSort} />
                <SortTh label="Score" k="score" sort={sort} onSort={toggleSort} align="right" />
                <SortTh label="Status" k="status" sort={sort} onSort={toggleSort} />
                <th className="px-2 text-center" title="Reference PDF">PDF</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => navigate(`/teacher/review/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/teacher/review/${r.id}`)}
                  className={`cursor-pointer hover:bg-paper/70 focus:bg-paper/70 focus:outline-none ${r.status === 'needs_review' ? 'bg-warn-soft/20' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="whitespace-nowrap font-medium text-ink">{r.studentName}</div>
                    <div className="font-mono text-xs text-muted">{r.usn}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDateTime(r.submittedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {r.total == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="font-serif text-base font-semibold tabular-nums">
                        {r.total}
                        <span className="text-sm font-normal text-muted"> / {r.max}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === 'needs_review' && (
                        <span className="text-xs text-ink-soft">
                          {r.pending} {r.pending === 1 ? 'answer' : 'answers'}
                        </span>
                      )}
                      {r.status === 'needs_review' && r.mismatch && <MismatchWarning />}
                      {r.status === 'needs_review' && r.lowConfidence && !r.mismatch && (
                        <Badge tone="warn">Low confidence</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-2 text-center">{r.hasReferencePdf && <ReferencePdfLink submissionId={r.id} />}</td>
                  <td className="px-2 text-muted">
                    <Icon name="chevronRight" size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function SortTh({ label, k, sort, onSort, align }) {
  const active = sort.key === k;
  return (
    <th className={`px-4 py-2.5 ${align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${active ? 'text-ink' : ''}`}>
        {label}
        <Icon name={active && sort.dir === 'desc' ? 'chevronDown' : 'chevronUp'} size={12} className={active ? '' : 'opacity-30'} />
      </button>
    </th>
  );
}
