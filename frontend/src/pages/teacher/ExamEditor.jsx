import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createExam, errorMessage, extractAnswerKey, getExam, publishExam, updateExam } from '../../api';
import { SUB_DOMAINS } from '../../utils/grading';
import FileUpload from '../../components/FileUpload';
import Icon from '../../components/Icon';
import { Alert, Badge, Button, Card, Loading, PageHeader, ProgressBar, StatusBadge } from '../../components/ui';

const EMPTY_META = { title: '', subject: '', subDomain: SUB_DOMAINS[0], totalMarks: 50, numQuestions: 6 };

export default function ExamEditor() {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(!!examId);
  const [exam, setExam] = useState(null); // persisted record
  const [meta, setMeta] = useState(EMPTY_META);
  const [keyFile, setKeyFile] = useState(null); // { name, size }
  const [progress, setProgress] = useState(null); // null | 0..100 while extracting
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null); // 'draft' | 'publish'
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!examId) {
      // Navigated to "new" from an existing exam — start fresh.
      setExam(null);
      setMeta(EMPTY_META);
      setQuestions([]);
      setKeyFile(null);
      setError('');
      return;
    }
    // Skip refetch when we just created this exam and navigated to its URL ourselves.
    if (exam?.id === examId) return;
    setLoading(true);
    getExam(examId)
      .then((e) => {
        setExam(e);
        setMeta({ title: e.title, subject: e.subject, subDomain: e.subDomain, totalMarks: e.totalMarks, numQuestions: e.numQuestions });
        setQuestions(e.questions);
        if (e.answerKeyFile) setKeyFile({ name: e.answerKeyFile, size: null });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [examId]);

  const locked = exam?.status === 'published';
  const extracting = progress !== null && progress < 100 && questions.length === 0;
  const metaValid = meta.title.trim() && meta.subject.trim() && Number(meta.totalMarks) > 0 && Number(meta.numQuestions) > 0;
  const marksSum = useMemo(() => questions.reduce((t, q) => t + (Number(q.marks) || 0), 0), [questions]);

  const setField = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }));

  const handleKey = async ([file]) => {
    setError('');
    setKeyFile({ name: file.name, size: file.size });
    setQuestions([]);
    setProgress(0);
    try {
      // The extraction endpoint belongs to an exam, so make sure a draft exists first.
      let target = exam;
      if (!target) {
        target = await createExam({ ...meta, totalMarks: Number(meta.totalMarks), numQuestions: Number(meta.numQuestions) });
        setExam(target);
        navigate(`/teacher/exams/${target.id}`, { replace: true });
      }
      const qs = await extractAnswerKey(target.id, file, meta, setProgress);
      setQuestions(qs);
    } catch (err) {
      setError(errorMessage(err));
      setKeyFile(null);
    } finally {
      setProgress(null);
    }
  };

  const updateQ = (id, patch) => setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const removeQ = (id) => setQuestions((qs) => qs.filter((q) => q.id !== id).map((q, i) => ({ ...q, number: i + 1 })));
  const addQ = () =>
    setQuestions((qs) => [
      ...qs,
      { id: `q-new-${Date.now()}`, number: qs.length + 1, text: '', referenceAnswer: '', type: 'subjective', marks: 5 },
    ]);

  const persist = async () => {
    const payload = {
      ...meta,
      totalMarks: Number(meta.totalMarks),
      numQuestions: questions.length || Number(meta.numQuestions),
      questions: questions.map((q) => ({ ...q, marks: Number(q.marks) })),
      answerKeyFile: keyFile?.name || null,
    };
    const saved = exam ? await updateExam(exam.id, payload) : await createExam(payload);
    setExam(saved);
    setQuestions(saved.questions); // ids may have been assigned by the server
    if (!exam) navigate(`/teacher/exams/${saved.id}`, { replace: true });
    return saved;
  };

  const saveDraft = async () => {
    setSaving('draft');
    setError('');
    try {
      await persist();
      setSavedAt(new Date());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  const publishProblems = [];
  if (!metaValid) publishProblems.push('Fill in the exam details.');
  if (!questions.length) publishProblems.push('Upload an answer key or add questions.');
  if (questions.some((q) => !q.text.trim() || !q.referenceAnswer.trim()))
    publishProblems.push('Every question needs question text and a reference answer.');
  if (questions.length && marksSum !== Number(meta.totalMarks))
    publishProblems.push(`Question marks add up to ${marksSum}, but total marks is ${meta.totalMarks}.`);

  const publish = async () => {
    if (publishProblems.length) return;
    setSaving('publish');
    setError('');
    try {
      const saved = await persist();
      const published = await publishExam(saved.id);
      setExam(published);
      setQuestions(published.questions);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        back={{ to: '/teacher/exams', label: 'All exams' }}
        title={exam ? exam.title : 'Create exam'}
        subtitle={exam ? exam.subject : 'Set up the exam, upload the answer key and check the extracted questions.'}
        actions={exam && <StatusBadge status={exam.status} />}
      />

      {error && <Alert className="mb-4">{error}</Alert>}
      {locked && <PublishedPanel exam={exam} />}

      <div className="space-y-6">
        {/* Step 1 — details */}
        <Section step={1} title="Exam details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="title" className="field-label">Title</label>
              <input id="title" className="field" placeholder="e.g. Mid-Semester Test I" value={meta.title} onChange={setField('title')} disabled={locked} />
            </div>
            <div>
              <label htmlFor="subject" className="field-label">Subject</label>
              <input id="subject" className="field" placeholder="e.g. Object-Oriented Programming with Java" value={meta.subject} onChange={setField('subject')} disabled={locked} />
            </div>
            <div>
              <label htmlFor="subDomain" className="field-label">Sub-domain</label>
              <select id="subDomain" className="field" value={meta.subDomain} onChange={setField('subDomain')} disabled={locked}>
                {SUB_DOMAINS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="totalMarks" className="field-label">Total marks</label>
              <input id="totalMarks" type="number" min={1} className="field tabular-nums" value={meta.totalMarks} onChange={setField('totalMarks')} disabled={locked} />
            </div>
            <div>
              <label htmlFor="numQuestions" className="field-label">Number of questions</label>
              <input id="numQuestions" type="number" min={1} max={50} className="field tabular-nums" value={meta.numQuestions} onChange={setField('numQuestions')} disabled={locked || questions.length > 0} />
              {questions.length > 0 && !locked && <p className="mt-1 text-xs text-muted">Set by the extracted answer key — add or remove questions below.</p>}
            </div>
          </div>
        </Section>

        {/* Step 2 — answer key */}
        <Section step={2} title="Answer key" subtitle="Upload the typed answer key as a PDF. Questions and reference answers are extracted automatically.">
          {!keyFile && (
            <>
              <FileUpload
                accept={{ 'application/pdf': ['.pdf'] }}
                onFiles={handleKey}
                disabled={!metaValid || locked}
                title="Drag & drop the answer key PDF"
                hint="PDF only"
                icon="file"
              />
              {!metaValid && <p className="mt-2 text-xs text-muted">Complete the exam details first.</p>}
            </>
          )}
          {keyFile && (
            <div className="flex flex-col gap-4 rounded-lg border border-line bg-paper/60 p-4 sm:flex-row sm:items-center">
              <PdfThumb />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{keyFile.name}</div>
                <div className="text-xs text-muted">
                  {keyFile.size ? `${(keyFile.size / 1024).toFixed(0)} KB · ` : ''}
                  {extracting ? 'Extracting text…' : questions.length ? `${questions.length} questions extracted` : 'Uploaded'}
                </div>
                {progress !== null && (
                  <div className="mt-3 max-w-md">
                    <ProgressBar value={progress} label={progress < 40 ? 'Reading PDF pages' : progress < 80 ? 'Extracting questions & answers' : 'Classifying question types'} />
                  </div>
                )}
              </div>
              {!locked && progress === null && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="refresh"
                  onClick={() => {
                    setKeyFile(null);
                    setQuestions([]);
                  }}
                >
                  Replace
                </Button>
              )}
            </div>
          )}
        </Section>

        {/* Step 3 — questions */}
        {(questions.length > 0 || (keyFile && progress === null)) && (
          <Section
            step={3}
            title="Review extracted questions"
            subtitle={locked ? undefined : 'Check each question and correct anything the extraction got wrong. These reference answers drive the grading.'}
            aside={
              <span className={`text-sm tabular-nums ${marksSum === Number(meta.totalMarks) ? 'text-ok' : 'text-warn'}`}>
                {marksSum} / {meta.totalMarks} marks allotted
              </span>
            }
          >
            <ol className="space-y-4">
              {questions.map((q) => (
                <QuestionEditor key={q.id} q={q} locked={locked} onChange={(patch) => updateQ(q.id, patch)} onRemove={() => removeQ(q.id)} />
              ))}
            </ol>
            {!locked && (
              <Button variant="secondary" size="sm" icon="plus" className="mt-4" onClick={addQ}>
                Add question
              </Button>
            )}
          </Section>
        )}

        {/* Step 4 — publish */}
        {!locked && questions.length > 0 && (
          <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Publish exam</h2>
                <p className="text-sm text-ink-soft">Publishing locks the questions so you can start uploading answer sheets.</p>
                {publishProblems.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-warn">
                    {publishProblems.map((p) => (
                      <li key={p} className="flex items-start gap-1.5">
                        <Icon name="alert" size={14} className="mt-0.5" /> {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {savedAt && <span className="text-xs text-muted">Saved {savedAt.toLocaleTimeString()}</span>}
                <Button variant="secondary" onClick={saveDraft} loading={saving === 'draft'} disabled={!metaValid || !!saving}>
                  Save draft
                </Button>
                <Button icon="lock" onClick={publish} loading={saving === 'publish'} disabled={publishProblems.length > 0 || !!saving}>
                  Publish exam
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Section({ step, title, subtitle, aside, children }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="flex gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-sm font-semibold text-paper">{step}</span>
          <div>
            <h2 className="text-lg font-semibold leading-7">{title}</h2>
            {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

function PdfThumb() {
  return (
    <div className="relative flex h-20 w-16 shrink-0 flex-col gap-1 rounded border border-line bg-white p-2 shadow-sm">
      <span className="absolute right-0 top-0 h-3 w-3 rounded-bl bg-paper-2" />
      {[80, 60, 70, 50, 65].map((w, i) => (
        <span key={i} className="h-1 rounded bg-line" style={{ width: `${w}%` }} />
      ))}
      <span className="mt-auto self-start rounded bg-bad px-1 text-[0.6rem] font-bold text-white">PDF</span>
    </div>
  );
}

function QuestionEditor({ q, locked, onChange, onRemove }) {
  const lowExtraction = q.extractionConfidence !== undefined && q.extractionConfidence < 0.6;
  return (
    <li className={`rounded-lg border p-4 ${lowExtraction && !q.text ? 'border-warn/40 bg-warn-soft/30' : 'border-line bg-paper/40'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="font-serif text-base font-semibold">Q{q.number}</span>
        <div className="inline-flex rounded-md border border-line bg-card p-0.5 text-xs font-medium" role="group" aria-label="Question type">
          {['objective', 'subjective'].map((t) => (
            <button
              key={t}
              type="button"
              disabled={locked}
              aria-pressed={q.type === t}
              onClick={() => onChange({ type: t })}
              className={`rounded px-2.5 py-1 capitalize ${q.type === t ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'} disabled:cursor-not-allowed`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          Marks
          <input
            type="number"
            min={0}
            className="field w-20 py-1 tabular-nums"
            value={q.marks}
            disabled={locked}
            onChange={(e) => onChange({ marks: e.target.value })}
          />
        </label>
        {lowExtraction && <Badge tone="warn" icon="alert">Could not read — please type</Badge>}
        {!locked && (
          <button type="button" onClick={onRemove} className="ml-auto rounded p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label={`Remove question ${q.number}`}>
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label className="field-label" htmlFor={`qt-${q.id}`}>Question text</label>
          <textarea id={`qt-${q.id}`} rows={4} className="field resize-y" value={q.text} disabled={locked} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
        <div>
          <label className="field-label" htmlFor={`qa-${q.id}`}>Reference answer</label>
          <textarea id={`qa-${q.id}`} rows={4} className="field resize-y" value={q.referenceAnswer} disabled={locked} onChange={(e) => onChange({ referenceAnswer: e.target.value })} />
        </div>
      </div>
    </li>
  );
}

function PublishedPanel({ exam }) {
  return (
    <Card className="mb-6 border-accent/30 bg-accent-soft/40 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Icon name="lock" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Exam published</h2>
          <p className="text-sm text-ink-soft">
            Questions are locked. Next, photograph each student’s answer sheet and upload it — grading starts automatically, and
            results appear on the review dashboard for you to check.
          </p>
        </div>
        <Button icon="upload" to={`/teacher/exams/${exam.id}/sheets`}>
          Upload answer sheets
        </Button>
      </div>
    </Card>
  );
}
