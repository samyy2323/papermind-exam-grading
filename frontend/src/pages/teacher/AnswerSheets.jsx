import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addStudent, errorMessage, getExam, getRoster, getSubmissions, removeStudent, uploadAnswerSheet } from '../../api';
import FileUpload from '../../components/FileUpload';
import Icon from '../../components/Icon';
import ProcessingTracker from '../../components/ProcessingTracker';
import ReferencePdfLink from '../../components/ReferencePdfLink';
import { Alert, Badge, Button, Card, EmptyState, Loading, PageHeader, ProgressBar, StatusBadge } from '../../components/ui';

const MAX_PAGES = 30;

export default function AnswerSheets() {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [sheets, setSheets] = useState([]); // latest submission row per student
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [pages, setPages] = useState([]); // { id, file, url }
  const [uploadPct, setUploadPct] = useState(null);
  const [running, setRunning] = useState(null); // { submissionId, studentId, done }
  const cameraRef = useRef(null);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const refreshSheets = () => getSubmissions(examId).then(setSheets).catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    setLoading(true);
    getExam(examId)
      .then(async (e) => {
        setExam(e);
        const [r, s] = await Promise.all([getRoster(e.classId), getSubmissions(examId)]);
        setRoster(r);
        setSheets(s);
        setSelectedId((cur) => cur ?? r.find((st) => !s.some((x) => x.studentId === st.id))?.id ?? r[0]?.id ?? null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [examId]);

  const sheetByStudent = useMemo(() => Object.fromEntries(sheets.map((s) => [s.studentId, s])), [sheets]);
  const selected = roster.find((s) => s.id === selectedId);
  const uploadedCount = roster.filter((s) => sheetByStudent[s.id]).length;

  // ---- photos -----------------------------------------------------------------
  const clearPages = () => {
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
  };
  const addFiles = (files) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setPages((prev) =>
      [...prev, ...imgs.map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, url: URL.createObjectURL(file) }))].slice(0, MAX_PAGES),
    );
  };
  const removePage = (id) =>
    setPages((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((x) => x.id !== id);
    });
  const move = (i, dir) =>
    setPages((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const selectStudent = (id) => {
    if (running && !running.done) return; // one sheet at a time while grading
    setRunning(null);
    setSelectedId(id);
    setError('');
  };

  const submit = async () => {
    setError('');
    setUploadPct(0);
    try {
      const res = await uploadAnswerSheet({ studentId: selected.id, examId: exam.id, files: pages.map((p) => p.file) }, setUploadPct);
      setRunning({ submissionId: res.submissionId, studentId: selected.id, done: false });
      clearPages();
      refreshSheets();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploadPct(null);
    }
  };

  const nextStudent = () => {
    const next = roster.find((s) => s.id !== selectedId && !sheetByStudent[s.id]);
    setRunning(null);
    if (next) setSelectedId(next.id);
  };

  // ---- roster -------------------------------------------------------------------
  const [newStudent, setNewStudent] = useState({ name: '', rollNumber: '' });
  const [adding, setAdding] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    setError('');
    try {
      const s = await addStudent(exam.classId, newStudent);
      setRoster((r) => [...r, s].sort((a, b) => a.rollNumber.localeCompare(b.rollNumber)));
      setNewStudent({ name: '', rollNumber: '' });
      setSelectedId(s.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };
  const remove = async (s) => {
    try {
      await removeStudent(exam.classId, s.id);
      setRoster((r) => r.filter((x) => x.id !== s.id));
      if (selectedId === s.id) setSelectedId(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading) return <Loading />;
  if (!exam) return <Alert>{error || 'Exam not found.'}</Alert>;
  if (exam.status !== 'published') {
    return (
      <>
        <PageHeader back={{ to: '/teacher/exams', label: 'All exams' }} title="Answer sheets" subtitle={exam.title} />
        <EmptyState icon="lock" title="Publish the exam first" action={<Button to={`/teacher/exams/${exam.id}`}>Open exam</Button>}>
          Answer sheets can be uploaded once the exam is published and its questions are locked.
        </EmptyState>
      </>
    );
  }

  const running_ = running && !running.done;
  const selectedSheet = selected && sheetByStudent[selected.id];

  return (
    <>
      <PageHeader
        back={{ to: '/teacher/exams', label: 'All exams' }}
        title="Answer sheets"
        subtitle={`${exam.title} · ${exam.subject} — photograph each student’s paper and upload it here.`}
        actions={<Button variant="secondary" to={`/teacher/review?exam=${exam.id}`} iconRight="arrowRight">Review dashboard</Button>}
      />
      {error && <Alert className="mb-4">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
        {/* ---------------- roster ---------------- */}
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-base font-semibold">Class roster</h2>
            <p className="text-xs text-ink-soft">
              {uploadedCount} of {roster.length} answer sheets uploaded
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2">
              <div className="h-full bg-accent" style={{ width: roster.length ? `${(uploadedCount / roster.length) * 100}%` : 0 }} />
            </div>
          </div>

          {roster.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">No students yet. Add the first one below.</p>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-line/70 overflow-y-auto">
              {roster.map((s) => {
                const sheet = sheetByStudent[s.id];
                const active = s.id === selectedId;
                return (
                  <li key={s.id} className={`group flex items-center ${active ? 'bg-accent-soft/60' : 'hover:bg-paper/70'}`}>
                    <button type="button" onClick={() => selectStudent(s.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left" aria-current={active}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${sheet ? (sheet.status === 'needs_review' ? 'bg-warn' : sheet.status === 'processing' ? 'bg-idle' : 'bg-ok') : 'border border-line bg-card'}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                        <span className="block font-mono text-xs text-muted">{s.rollNumber}</span>
                      </span>
                    </button>
                    {sheet ? (
                      <span className="flex items-center pr-2">
                        <ReferencePdfLink submissionId={sheet.id} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => remove(s)}
                        className="mr-2 rounded p-1.5 text-muted opacity-0 hover:bg-bad-soft hover:text-bad focus:opacity-100 group-hover:opacity-100"
                        aria-label={`Remove ${s.name} from roster`}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={add} className="space-y-2 border-t border-line bg-paper/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Add student</div>
            <input className="field" placeholder="Full name" aria-label="Student name" value={newStudent.name} onChange={(e) => setNewStudent((n) => ({ ...n, name: e.target.value }))} />
            <div className="flex gap-2">
              <input className="field font-mono" placeholder="Roll no. / ID" aria-label="Roll number" value={newStudent.rollNumber} onChange={(e) => setNewStudent((n) => ({ ...n, rollNumber: e.target.value }))} />
              <Button type="submit" size="sm" icon="plus" loading={adding} disabled={!newStudent.name.trim() || !newStudent.rollNumber.trim()}>
                Add
              </Button>
            </div>
          </form>
        </Card>

        {/* ---------------- upload / progress ---------------- */}
        <div className="min-w-0">
          {!selected ? (
            <EmptyState icon="inbox" title={roster.length ? 'Select a student' : 'Add students to your roster'}>
              {roster.length ? 'Choose a student on the left, then upload photos of their answer sheet.' : 'Add the students of this class, then upload each answer sheet.'}
            </EmptyState>
          ) : running ? (
            <Card className="p-5 sm:p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="text-sm text-ink-soft">{running.done ? 'Grading finished.' : 'Answer sheet uploaded — grading in progress.'}</p>
                </div>
                <span className="font-mono text-xs text-muted">{selected.rollNumber}</span>
              </div>
              <ProcessingTracker
                key={running.submissionId}
                submissionId={running.submissionId}
                onDone={() => {
                  setRunning((r) => r && { ...r, done: true });
                  refreshSheets();
                }}
              />
              {running.done ? (
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-6">
                  <Button variant="secondary" size="lg" to={`/teacher/review/${running.submissionId}`}>Review result</Button>
                  <ReferencePdfLink submissionId={running.submissionId} label />
                  <Button size="lg" iconRight="arrowRight" onClick={nextStudent}>Next student</Button>
                </div>
              ) : (
                <p className="mt-6 text-center text-sm text-ink-soft">You can keep this page open; results appear on the review dashboard when done.</p>
              )}
            </Card>
          ) : (
            <Card className="p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Upload answer sheet — {selected.name}</h2>
                  <p className="text-sm text-ink-soft">
                    Roll no. <span className="font-mono">{selected.rollNumber}</span> · photograph every page in order, in good light, with the whole page in frame.
                  </p>
                </div>
                {selectedSheet && (
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedSheet.status} />
                    <ReferencePdfLink submissionId={selectedSheet.id} label />
                  </div>
                )}
              </div>

              {selectedSheet && (
                <Alert tone="warn" className="mb-4">
                  {selected.name} already has an answer sheet for this exam. Uploading again replaces it in the review dashboard (the earlier upload is kept for the record).
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <FileUpload
                  multiple
                  compact
                  accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.webp'] }}
                  onFiles={addFiles}
                  disabled={pages.length >= MAX_PAGES || uploadPct !== null}
                  title="Drag & drop page photos"
                  hint="JPG, PNG, HEIC"
                  icon="image"
                />
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  disabled={pages.length >= MAX_PAGES || uploadPct !== null}
                  className="flex flex-row items-center justify-center gap-2 rounded-lg border border-line bg-card px-6 py-4 text-sm font-medium text-ink hover:border-accent/50 hover:text-accent disabled:opacity-50 sm:flex-col"
                >
                  <Icon name="camera" size={22} />
                  Take photo
                </button>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {pages.length > 0 && (
                <>
                  <div className="mb-2 mt-5 flex items-baseline justify-between text-xs text-ink-soft">
                    <span>Check the order — page 1 first. Use the arrows to reorder.</span>
                    <span className="tabular-nums">{pages.length} / {MAX_PAGES} pages</span>
                  </div>
                  <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {pages.map((p, i) => (
                      <li key={p.id} className="relative overflow-hidden rounded-md border border-line bg-paper-2">
                        <img src={p.url} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                        <span className="absolute left-2 top-2 rounded bg-ink/85 px-1.5 py-0.5 text-xs font-semibold text-paper">Page {i + 1}</span>
                        <button type="button" onClick={() => removePage(p.id)} className="absolute right-2 top-2 rounded-full bg-card/95 p-1 text-ink-soft shadow hover:text-bad" aria-label={`Remove page ${i + 1}`}>
                          <Icon name="x" size={14} strokeWidth={2.4} />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/70 to-transparent px-2 pb-1.5 pt-6">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded bg-card/95 p-1 text-ink disabled:opacity-30" aria-label={`Move page ${i + 1} earlier`}>
                            <Icon name="chevronLeft" size={14} strokeWidth={2.4} />
                          </button>
                          <span className="max-w-[60%] truncate text-[0.7rem] text-paper">{p.file.name}</span>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === pages.length - 1} className="rounded bg-card/95 p-1 text-ink disabled:opacity-30" aria-label={`Move page ${i + 1} later`}>
                            <Icon name="chevronRight" size={14} strokeWidth={2.4} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                {uploadPct !== null && (
                  <div className="sm:w-64">
                    <ProgressBar value={uploadPct} label="Uploading pages" />
                  </div>
                )}
                {pages.length > 0 && uploadPct === null && (
                  <Button variant="ghost" onClick={clearPages}>Clear</Button>
                )}
                <Button size="lg" icon="upload" onClick={submit} disabled={pages.length === 0 || uploadPct !== null || running_} loading={uploadPct !== null} className="w-full sm:w-auto">
                  Upload &amp; grade
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
