import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { isHR } from '../api';
import { useMe, useSession } from '../session';

export function Layout() {
  const { employee, company } = useMe();
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const hr = isHR(employee);
  const isManager = hr || employee.role === 'manager';

  const links: { to: string; label: string; show: boolean }[] = [
    { to: '/', label: 'Dashboard', show: true },
    { to: '/leave', label: 'My Leave', show: true },
    { to: '/attendance', label: 'My Attendance', show: true },
    { to: '/approvals', label: 'Approvals', show: isManager },
    { to: '/team', label: hr ? 'Today in Office' : 'My Team Today', show: isManager },
    { to: '/employees', label: 'Employees', show: true },
    { to: '/holidays', label: 'Holidays', show: true },
    { to: '/assistant', label: 'HR Assistant', show: true },
    { to: '/profile', label: 'My Profile', show: true },
    { to: '/settings', label: 'Settings', show: hr },
  ];

  const nav = (
    <nav className="flex flex-col gap-1">
      {links.filter((l) => l.show).map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.to === '/'}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-sky-light text-deep' : 'text-gray-600 hover:bg-gray-50 hover:text-deep'}`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button className="rounded p-1 text-deep md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <span className="truncate text-sm font-medium text-gray-700">{company.name}</span>
        </div>
        {/* Brand mark sits top-right as per brand rules. Replace with the logo file when available. */}
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-gray-500 sm:inline">{employee.fullName}</span>
          <button onClick={signOut} className="text-sm text-gray-500 hover:text-deep">Sign out</button>
          <span className="font-heading text-lg font-bold text-deep">
            Ivy <span className="text-sky">HRMS</span>
          </span>
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-gray-200 p-3 md:block">{nav}</aside>
        {open && <div className="fixed inset-x-0 top-14 z-30 border-b border-gray-200 bg-white p-3 shadow md:hidden">{nav}</div>}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
