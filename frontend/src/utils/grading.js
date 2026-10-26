// Review-flag rules shared by student + teacher views.
export const CONFIDENCE_THRESHOLD = 0.6;
export const LOW_RELEVANCE_THRESHOLD = 0.35;
export const HIGH_SCORE_RATIO = 0.7;

export function effectiveScore(answer) {
  if (answer.override) return answer.override.score;
  return answer.aiScore ?? 0; // null when hidden from students (answer pending review)
}

export function answerFlags(answer, question) {
  // The real backend decides flags and reports them as `flaggedReason`; mock data falls back to the thresholds.
  if (answer.flaggedReason !== undefined) {
    return {
      lowConfidence: answer.flaggedReason === 'low_confidence' || answer.flaggedReason === 'parse_failure',
      relevanceMismatch: answer.flaggedReason === 'injection_suspected',
      answerNotFound: answer.flaggedReason === 'answer_not_found',
      segmentationUncertain: answer.flaggedReason === 'segmentation_uncertain',
    };
  }
  const lowConfidence = answer.confidence < CONFIDENCE_THRESHOLD;
  const relevanceMismatch =
    question.type === 'subjective' &&
    answer.relevance < LOW_RELEVANCE_THRESHOLD &&
    answer.aiScore / question.marks >= HIGH_SCORE_RATIO;
  const answerNotFound = !answer.ocrText?.trim();
  return { lowConfidence, relevanceMismatch, answerNotFound, segmentationUncertain: false };
}

// An answer needs review if flagged and the teacher hasn't resolved it yet.
export function needsReview(answer, question) {
  if (answer.override || answer.reviewed) return false;
  if (typeof answer.pendingReview === 'boolean') return answer.pendingReview;
  const f = answerFlags(answer, question);
  return f.lowConfidence || f.relevanceMismatch || f.answerNotFound || f.segmentationUncertain;
}

export function summarizeSubmission(submission, exam) {
  if (submission.status === 'processing') {
    return { status: 'processing', total: null, max: exam.totalMarks, pending: 0, mismatch: false, finalScore: null };
  }
  const qById = Object.fromEntries(exam.questions.map((q) => [q.id, q]));
  let total = 0;
  let pending = 0;
  let mismatch = false;
  let lowConf = false;
  for (const a of submission.answers) {
    const q = qById[a.questionId];
    if (!q) continue;
    total += effectiveScore(a);
    if (needsReview(a, q)) {
      pending += 1;
      const f = answerFlags(a, q);
      if (f.relevanceMismatch) mismatch = true;
      if (f.lowConfidence) lowConf = true;
    }
  }
  return {
    status: pending > 0 ? 'needs_review' : 'graded',
    total,
    max: exam.totalMarks,
    pending,
    mismatch,
    lowConf,
  };
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const SUB_DOMAINS = [
  'Object-Oriented Programming',
  'AI & ML',
  'Software Engineering',
  'Cybersecurity',
  'Programming Fundamentals',
];
