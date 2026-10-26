import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import Icon from '../components/Icon';

export default function AppShell({ nav, roleLabel }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const linkCls = ({ isActive }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
    }`;
  const tabCls = ({ isActive }) =>
    `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
      isActive ? 'border-accent text-accent' : 'border-transparent text-ink-soft'
    }`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="shrink-0">
            <Logo size={26} />
          </NavLink>
          <span className="hidden rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-ink-soft sm:inline">
            {roleLabel}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium text-ink">{user?.name}</div>
              <div className="text-xs text-muted">{user?.email}</div>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-serif text-sm font-semibold text-paper sm:hidden">
              {user?.name?.[0]}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-2 hover:text-ink"
            >
              <Icon name="logout" size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
        {/* Mobile tab navigation */}
        <nav className="flex overflow-x-auto border-t border-line px-2 md:hidden" aria-label="Main">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={tabCls}>
              <Icon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 sm:px-6">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav className="sticky top-14 flex flex-col gap-1 py-6" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkCls}>
                <Icon name={item.icon} size={18} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 py-6 pb-16">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
