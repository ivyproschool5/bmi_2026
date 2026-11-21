export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? (options.body || options.form ? 'POST' : 'GET'),
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? data?.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/* ---------- Shared types (mirror the API) ---------- */

export type Role = 'admin' | 'hr' | 'manager' | 'employee';

export interface Employee {
  id: string;
  companyId: string;
  employeeCode: string | null;
  fullName: string;
  email: string;
  designation: string | null;
  department: string | null;
  managerId: string | null;
  role: Role;
  dateOfJoining: string | null;
  status: 'active' | 'exited';
  mustChangePassword: boolean;
  hasLogin?: boolean;
}

export interface Company {
  id: string;
  name: string;
  weeklyOffs: number[];
  policyText: string;
}

export interface Me {
  user: { id: string; name: string; email: string };
  employee: Employee | null;
  company: Company | null;
  signupAllowed: boolean;
}

export interface Balance {
  leaveTypeId: string;
  name: string;
  code: string;
  quota: number;
  taken: number;
  pending: number;
  available: number;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  annualQuota: string;
  active: boolean;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  leaveCode: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approverName: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
}

export interface Doc {
  id: string;
  employeeId: string;
  name: string;
  contentType: string | null;
  size: number;
  createdAt: string;
}

/* ---------- Formatting ---------- */

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const fmtTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';

export const fmtDays = (n: number | string) => {
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toFixed(1)} day${v === 1 ? '' : 's'}`;
};

/** Today's date in India Standard Time as YYYY-MM-DD. */
export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export const isHR = (e: Employee | null | undefined) => e?.role === 'admin' || e?.role === 'hr';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
