// PaperMind API service layer: one function per backend endpoint.
import { http, data } from './client';

export const PIPELINE_STAGES = ['ocr', 'grading', 'done'];

const upload = (url, form, onProgress, config = {}) =>
  data(
    http.post(url, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
      ...config,
    }),
  );

const toForm = (fields) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((item) => f.append(k, item));
    else if (v !== undefined && v !== null) f.append(k, v);
  });
  return f;
};

// ---- Auth -----------------------------------------------------------------
export const login = (email, password) => data(http.post('/auth/login', { email, password }));
export const register = (name, email, password) => data(http.post('/auth/register', { name, email, password }));

// ---- Exams ----------------------------------------------------------------
export const getExams = () => data(http.get('/exams'));

export const getExam = (examId) => data(http.get(`/exams/${examId}`));

export const createExam = (payload) =>
  data(
    http.post('/exams', {
      title: payload.title,
      subject: payload.subject,
      subDomain: payload.subDomain,
      totalMarks: payload.totalMarks,
      numQuestions: payload.numQuestions,
    }),
  );

// Saves the exam fields and the whole (draft) question list.
export const updateExam = async (examId, patch) => {
  await http.patch(`/exams/${examId}`, {
    title: patch.title,
    subject: patch.subject,
    subDomain: patch.subDomain,
    totalMarks: patch.totalMarks,
    numQuestions: patch.numQuestions,
    answerKeyFile: patch.answerKeyFile,
  });
  if (patch.questions) await http.put(`/exams/${examId}/questions`, patch.questions);
  return data(http.get(`/exams/${examId}`));
};

export const publishExam = (examId) => data(http.post(`/exams/${examId}/publish`));

// Uploads the answer-key PDF; the backend reads it and returns the extracted questions.
// Reading a long key with the local model can take a few minutes, so the timeout is generous.
export const extractAnswerKey = (examId, file, meta, onProgress) =>
  upload(
    `/exams/${examId}/answer-key`,
    toForm({ file, numQuestions: meta?.numQuestions, totalMarks: meta?.totalMarks }),
    onProgress,
    { timeout: 20 * 60 * 1000 },
  );

// ---- Roster ---------------------------------------------------------------
export const getRoster = (classId) => data(http.get(`/classes/${classId}/roster`));
export const addStudent = (classId, student) => data(http.post(`/classes/${classId}/roster`, student));
export const updateStudent = (classId, studentId, patch) => data(http.patch(`/classes/${classId}/roster/${studentId}`, patch));
export const removeStudent = (classId, studentId) => data(http.delete(`/classes/${classId}/roster/${studentId}`));

// ---- Answer sheets (the teacher uploads photos for a student) --------------
export const uploadAnswerSheet = ({ studentId, examId, files }, onProgress) =>
  upload(`/students/${studentId}/answer-sheet`, toForm({ examId, files }), onProgress, { timeout: 5 * 60 * 1000 });

export const getSubmissionStatus = (submissionId) => data(http.get(`/answer-sheets/${submissionId}/status`));
export const getSubmission = (submissionId) => data(http.get(`/answer-sheets/${submissionId}/results`));
export const getSubmissions = (examId) => data(http.get(`/exams/${examId}/submissions`));
export const getReviewQueue = (examId) => data(http.get(`/exams/${examId}/review-queue`));
export const reprocessSubmission = (submissionId) => data(http.post(`/answer-sheets/${submissionId}/reprocess`));

// The answer key exactly as it was uploaded, as an object URL for the in-page viewer.
export const fetchAnswerKeyUrl = async (examId) => {
  const res = await http.get(`/exams/${examId}/answer-key-file`, { responseType: 'blob' });
  return URL.createObjectURL(res.data);
};

// The student's whole answer sheet as one PDF (uploaded photos and PDFs combined). Fetched with the
// auth header, so it can't be a plain <a href>; the caller gets an object URL to show or download.
export const fetchSheetPdfUrl = async (submissionId) => {
  const res = await http.get(`/answer-sheets/${submissionId}/reference-pdf`, { responseType: 'blob' });
  return URL.createObjectURL(res.data);
};

// Opens the answer-sheet PDF in a new tab.
export const openReferencePdf = async (submissionId) => {
  const url = await fetchSheetPdfUrl(submissionId);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// ---- Teacher review ---------------------------------------------------------
export const overrideScore = (answerId, score, reason) =>
  data(http.patch(`/student-answers/${answerId}/override`, { score: Number(score), reason }));
export const markReviewed = (answerId) => data(http.post(`/student-answers/${answerId}/review`));

// ---- Analytics ------------------------------------------------------------
export const getAnalytics = (examId) => data(http.get(`/exams/${examId}/analytics`));

export function errorMessage(err) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join('; ');
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the backend running?';
  return err?.response?.data?.message || err?.message || 'Something went wrong.';
}
