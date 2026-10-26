import { useEffect, useRef, useState } from 'react';
import { getSubmissionStatus, PIPELINE_STAGES, errorMessage } from '../api';
import StepIndicator from './StepIndicator';
import { Alert } from './ui';

const STEPS = [
  { key: 'ocr', label: 'Reading handwriting', description: 'OCR on each page' },
  { key: 'grading', label: 'Grading answers', description: 'Against the answer key' },
  { key: 'done', label: 'Done', description: 'Results ready' },
];

// Polls the grading pipeline for a submission and renders its progress.
export default function ProcessingTracker({ submissionId, onDone, onError, interval = 3000 }) {
  const [stage, setStage] = useState('ocr');
  const [error, setError] = useState('');
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let timer;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await getSubmissionStatus(submissionId);
        if (cancelled) return;
        setStage(res.stage);
        if (res.error) {
          // The pipeline stopped and flagged the sheet for manual review.
          setError(res.error);
          errorRef.current?.(res.error);
          return;
        }
        if (res.stage === 'done') {
          doneRef.current?.();
          return;
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
      timer = setTimeout(tick, interval);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [submissionId, interval]);

  const idx = PIPELINE_STAGES.indexOf(stage);
  return (
    <div>
      <StepIndicator steps={STEPS} current={Math.max(0, idx)} complete={stage === 'done'} />
      {error && <Alert className="mt-4">{error}</Alert>}
    </div>
  );
}
