import { useParams } from 'react-router-dom';
import { errorMessage, getSubmission, markReviewed, overrideScore, reprocessSubmission } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useState } from 'react';
import useAsync from '../../utils/useAsync';
import QuestionBreakdown from '../../components/QuestionBreakdown';
import ScoreSummary from '../../components/ScoreSummary';
import { Alert, Button, Card, Loading, PageHeader, Spinner } from '../../components/ui';

export default function SubmissionReview() {
  const { submissionId } = useParams();
  const { user } = useAuth();
  const { data, loading, error, setData, reload } = useAsync(() => getSubmission(submissionId), [submissionId]);

  const patchAnswer = (updated) =>
    setData((d) => ({
      ...d,
      submission: {
        ...d.submission,
        answers: d.submission.answers.map((a) => (a.questionId === updated.questionId ? updated : a)),
      },
    }));

  // Answers are addressed by their own id; the breakdown reports the question being edited.
  const answerFor = (questionId) => data.submission.answers.find((a) => a.questionId === questionId);
  const handleOverride = async (questionId, score, reason) => {
    const a = answerFor(questionId);
    const updated = await overrideScore(a.id, score, reason, user);
    patchAnswer({ ...a, ...updated });
  };
  const handleReviewed = async (questionId) => {
    const a = answerFor(questionId);
    patchAnswer({ ...a, ...(await markReviewed(a.id)) });
  };

  const [reprocessing, setReprocessing] = useState(false);
  const [actionError, setActionError] = useState('');
  const reprocess = async () => {
    setReprocessing(true);
    setActionError('');
    try {
      await reprocessSubmission(submissionId);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setReprocessing(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const { exam, submission } = data;
  const back = { to: `/teacher/review?exam=${exam.id}`, label: 'Back to review dashboard' };

  if (submission.status === 'processing') {
    return (
      <>
        <PageHeader back={back} title={submission.studentName} subtitle={`${exam.title} · ${exam.subject}`} />
        <Card className="flex items-center gap-3 p-6 text-ink-soft">
          <Spinner /> This answer sheet is still being processed ({submission.pages} pages). Check back shortly.
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader back={back} title={submission.studentName} subtitle={`${exam.title} · ${exam.subject}`} />
      {actionError && <Alert className="mb-4">{actionError}</Alert>}
      {submission.error && (
        <Alert tone="warn" className="mb-6">
          <div className="font-medium">This answer sheet needs attention</div>
          <p className="mt-0.5">{submission.error}</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" icon="refresh" onClick={reprocess} loading={reprocessing}>
              Reprocess the uploaded photos
            </Button>
          </div>
        </Alert>
      )}
      {submission.answers.length === 0 ? (
        <Card className="p-6 text-sm text-ink-soft">No answers could be extracted from the uploaded photos.</Card>
      ) : (
      <div className="space-y-6">
        <ScoreSummary exam={exam} submission={submission} mode="teacher" />
        <QuestionBreakdown exam={exam} submission={submission} mode="teacher" onOverride={handleOverride} onMarkReviewed={handleReviewed} />
      </div>
      )}
    </>
  );
}
