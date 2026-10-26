import AppShell from './AppShell';

const NAV = [
  { to: '/teacher/exams', label: 'Exams', icon: 'exam' },
  { to: '/teacher/review', label: 'Review Dashboard', icon: 'clipboard' },
  { to: '/teacher/analytics', label: 'Analytics', icon: 'chart' },
];

export default function TeacherLayout() {
  return <AppShell nav={NAV} roleLabel="Teacher" />;
}
