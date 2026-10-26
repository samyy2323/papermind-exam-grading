import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api';
import Logo from '../components/Logo';
import { Alert, Button } from '../components/ui';

export default function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin'); // signin | signup
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to="/teacher" replace />;

  const signUp = mode === 'signup';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (signUp) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
      navigate('/teacher');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Logo size={40} withText={false} />
            <h1 className="mt-4 text-4xl font-semibold">PaperMind</h1>
            <p className="mx-auto mt-3 max-w-sm text-ink-soft">
              Handwritten answer sheets, graded against your answer key — with every uncertain mark routed back to you.
            </p>
          </div>

          <form onSubmit={submit} className="rounded-lg border border-line bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold">{signUp ? 'Create your teacher account' : 'Sign in'}</h2>
            {error && <Alert className="mt-4">{error}</Alert>}

            {signUp && (
              <div className="mt-4">
                <label htmlFor="name" className="field-label">Full name</label>
                <input id="name" className="field" autoComplete="name" required value={form.name} onChange={set('name')} />
              </div>
            )}
            <div className="mt-4">
              <label htmlFor="email" className="field-label">Email</label>
              <input id="email" type="email" className="field" autoComplete="email" required value={form.email} onChange={set('email')} />
            </div>
            <div className="mt-4">
              <label htmlFor="password" className="field-label">Password</label>
              <input
                id="password"
                type="password"
                className="field"
                autoComplete={signUp ? 'new-password' : 'current-password'}
                minLength={signUp ? 6 : undefined}
                required
                value={form.password}
                onChange={set('password')}
              />
              {signUp && <p className="mt-1 text-xs text-muted">At least 6 characters.</p>}
            </div>

            <Button type="submit" className="mt-6 w-full" loading={busy}>
              {signUp ? 'Create account' : 'Sign in'}
            </Button>

            <p className="mt-4 text-center text-sm text-ink-soft">
              {signUp ? 'Already have an account?' : 'New to PaperMind?'}{' '}
              <button
                type="button"
                className="font-medium text-accent underline underline-offset-2"
                onClick={() => {
                  setMode(signUp ? 'signin' : 'signup');
                  setError('');
                }}
              >
                {signUp ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
