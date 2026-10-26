import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import TeacherLayout from './layouts/TeacherLayout';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import ExamsList from './pages/teacher/ExamsList';
import ExamEditor from './pages/teacher/ExamEditor';
import AnswerSheets from './pages/teacher/AnswerSheets';
import ReviewDashboard from './pages/teacher/ReviewDashboard';
import SubmissionReview from './pages/teacher/SubmissionReview';
import Analytics from './pages/teacher/Analytics';

function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/login" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? '/teacher' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      <Route
        path="/teacher"
        element={
          <RequireRole role="teacher">
            <TeacherLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="exams" replace />} />
        <Route path="exams" element={<ExamsList />} />
        <Route path="exams/new" element={<ExamEditor />} />
        <Route path="exams/:examId" element={<ExamEditor />} />
        <Route path="exams/:examId/sheets" element={<AnswerSheets />} />
        <Route path="review" element={<ReviewDashboard />} />
        <Route path="review/:submissionId" element={<SubmissionReview />} />
        <Route path="analytics" element={<Analytics />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
