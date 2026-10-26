import { Link } from 'react-router-dom';
import { getExams } from '../../api';
import useAsync from '../../utils/useAsync';
import { formatDate } from '../../utils/grading';
import { Alert, Button, Card, EmptyState, Loading, PageHeader, StatusBadge } from '../../components/ui';
import Icon from '../../components/Icon';

export default function ExamsList() {
  const { data: exams, loading, error } = useAsync(getExams);

  return (
    <>
      <PageHeader
        title="Exams"
        subtitle="Create an exam, upload its answer key, then publish it and upload each student’s answer sheet."
        actions={exams?.length > 0 && <Button to="/teacher/exams/new" icon="plus">Create exam</Button>}
      />
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {exams && exams.length === 0 && (
        <EmptyState
          icon="exam"
          title="No exams yet"
          action={<Button to="/teacher/exams/new" icon="plus">Create your first exam</Button>}
        >
          Start by creating an exam and uploading a typed answer key (PDF). PaperMind will extract each question and
          reference answer for you to check.
        </EmptyState>
      )}
      {exams && exams.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {exams.map((exam) => (
            <Card key={exam.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">{exam.subDomain}</div>
                  <Link to={`/teacher/exams/${exam.id}`} className="mt-1 block font-serif text-lg font-semibold text-ink hover:text-accent">
                    {exam.title}
                  </Link>
                  <div className="text-sm text-ink-soft">{exam.subject}</div>
                </div>
                <StatusBadge status={exam.status} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-line/70 py-3 text-sm">
                <div>
                  <dt className="text-xs text-muted">Questions</dt>
                  <dd className="font-medium tabular-nums">{exam.questions.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Total marks</dt>
                  <dd className="font-medium tabular-nums">{exam.totalMarks}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Submissions</dt>
                  <dd className="font-medium tabular-nums">{exam.submissionCount}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted">
                  {exam.status === 'published' ? <>Published {formatDate(exam.publishedAt)}</> : <>Created {formatDate(exam.createdAt)}</>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {exam.status === 'published' && (
                    <Button size="sm" icon="upload" to={`/teacher/exams/${exam.id}/sheets`}>
                      Answer sheets
                    </Button>
                  )}
                  {exam.status === 'published' && exam.submissionCount > 0 && (
                    <Button size="sm" variant="ghost" to={`/teacher/review?exam=${exam.id}`}>
                      Review
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" to={`/teacher/exams/${exam.id}`} iconRight="chevronRight">
                    {exam.status === 'draft' ? 'Continue editing' : 'View'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          <Link
            to="/teacher/exams/new"
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-sm font-medium text-ink-soft hover:border-accent/50 hover:text-accent"
          >
            <Icon name="plus" size={22} />
            New exam
          </Link>
        </div>
      )}
    </>
  );
}
