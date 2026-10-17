import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { currencyCode, label } from '../lib/format';
import { loadSettings } from '../lib/queries';
import { SecurityDialog } from './SecurityDialog';
import { StatusPill } from './StatusPill';
import { UpdateBanner } from './UpdateBanner';

interface NavItem { to: string; label: string; any: string[] }

const NAV: NavItem[] = [
  { to: '/pos', label: 'Point of sale', any: ['sale:create'] },
  { to: '/', label: 'Dashboard', any: ['dashboard:read'] },
  { to: '/products', label: 'Products', any: ['product:write', 'report:read'] },
  { to: '/receiving', label: 'Receiving', any: ['stock:receive'] },
  { to: '/inventory', label: 'Inventory', any: ['stock:adjust', 'stock:receive', 'report:read'] },
  { to: '/purchases', label: 'Purchases', any: ['purchase:read'] },
  { to: '/suppliers', label: 'Suppliers', any: ['supplier:read'] },
  { to: '/sales', label: 'Sales', any: ['sale:read'] },
  { to: '/shifts', label: 'Shifts', any: ['session:own'] },
  { to: '/promotions', label: 'Promotions', any: ['promotion:manage'] },
  { to: '/customers', label: 'Customers', any: ['customer:read'] },
  { to: '/expenses', label: 'Expenses', any: ['expense:read'] },
  { to: '/reports', label: 'Reports', any: ['report:read'] },
  { to: '/audit', label: 'Audit log', any: ['audit:read'] },
  { to: '/users', label: 'Users', any: ['user:manage'] },
  { to: '/settings', label: 'Settings', any: ['settings:manage'] },
];

export const Layout = () => {
  const { session, canAny, logout } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const items = NAV.filter((item) => canAny(...item.any));
  const compact = pathname === '/pos';
  const settings = useQuery({ queryKey: ['settings'], queryFn: loadSettings });

  const links = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={() => setOpen(false)}
          className={({ isActive }) => `rounded-field px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-ink hover:bg-ink/5'}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
        <button type="button" aria-label="Menu" onClick={() => setOpen((v) => !v)} className="rounded p-2 hover:bg-ink/5 lg:hidden">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
        </button>
        <div className="font-bold tracking-tight">{session?.branch?.name ?? 'All branches'}</div>
        <div className="ml-auto flex items-center gap-3">
          <StatusPill />
          <div className="hidden text-right text-sm leading-tight sm:block">
            <div className="font-semibold">{session?.user.name}</div>
            <div className="text-xs text-muted">{label(session?.user.role ?? '')}</div>
          </div>
          <button type="button" onClick={() => setChangingPassword(true)} className="rounded-field border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper">Security</button>
          <button type="button" onClick={() => void logout()} className="rounded-field border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper">Sign out</button>
          {changingPassword && <SecurityDialog onClose={() => setChangingPassword(false)} />}
        </div>
      </header>
      {session && !session.loginApproval.configured && (
        <div role="alert" className="border-b border-line bg-warn-soft px-4 py-1.5 text-sm font-medium text-warn">
          Email sign-in approval is OFF on this server. Everyone signs in with a password only.{canAny('settings:manage') ? ' Set up email (see the README) to turn it on.' : ' Tell your administrator.'}
        </div>
      )}
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <aside className={`${compact ? 'hidden' : 'hidden lg:block'} w-56 shrink-0 overflow-y-auto border-r border-line bg-white p-3`}>{links}</aside>
        {open && <div className="absolute inset-x-0 top-[53px] z-40 border-b border-line bg-white p-3 shadow-lg lg:hidden">{links}</div>}
        <main className={`min-w-0 flex-1 overflow-y-auto ${compact ? '' : 'p-4 sm:p-6'}`}>
          <Outlet key={settings.data?.currency ?? currencyCode()} />
        </main>
      </div>
    </div>
  );
};
