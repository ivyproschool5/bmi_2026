import { useState } from 'react';
import { api, fmtTime, isHR, todayIST, type AttendanceRecord, type Employee, type Holiday } from '../api';
import { useMe } from '../session';
import { Badge, Card, Empty, ErrorText, Field, Input, PageHeader, Select, Table, Td, useLoad } from '../components/ui';
import { CheckInCard } from './Dashboard';

interface MonthData {
  month: string;
  from: string;
  to: string;
  weeklyOffs: number[];
  records: AttendanceRecord[];
  leaves: { fromDate: string; toDate: string; halfDay: boolean; code: string }[];
  holidays: Holiday[];
}

const hours = (a: AttendanceRecord) =>
  a.checkIn && a.checkOut ? ((new Date(a.checkOut).getTime() - new Date(a.checkIn).getTime()) / 3_600_000).toFixed(1) + ' h' : '';

function MonthGrid({ data }: { data: MonthData }) {
  const today = todayIST();
  const first = new Date(data.from + 'T00:00:00Z');
  const lastDay = Number(data.to.slice(8, 10));
  const blanks = first.getUTCDay();
  const cells: (string | null)[] = [...Array(blanks).fill(null)];
  for (let d = 1; d <= lastDay; d++) cells.push(`${data.month}-${String(d).padStart(2, '0')}`);

  const info = (date: string) => {
    const rec = data.records.find((r) => r.date === date);
    const hol = data.holidays.find((h) => h.date === date);
    const leave = data.leaves.find((l) => l.fromDate <= date && l.toDate >= date);
    const off = data.weeklyOffs.includes(new Date(date + 'T00:00:00Z').getUTCDay());
    if (rec?.checkIn) return { cls: 'bg-green-50 border-green-200', label: `${fmtTime(rec.checkIn)}${rec.checkOut ? ' - ' + fmtTime(rec.checkOut) : ''}` };
    // Holidays and weekly offs are not counted as leave, so show them first.
    if (hol) return { cls: 'bg-sky-light border-sky/30', label: hol.name };
    if (off) return { cls: 'bg-gray-50 border-gray-200', label: 'Off' };
    if (leave) return { cls: 'bg-amber-light border-amber/40', label: leave.code + (leave.halfDay ? ' (half)' : '') };
    if (date < today) return { cls: 'bg-red-50 border-red-200', label: 'Absent' };
    return { cls: 'bg-white border-gray-200', label: '' };
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const { cls, label } = info(date);
          return (
            <div key={date} className={`min-h-16 rounded border p-1.5 text-left ${cls} ${date === today ? 'ring-2 ring-sky' : ''}`}>
              <div className="text-xs font-semibold text-gray-700">{Number(date.slice(8))}</div>
              <div className="mt-0.5 text-[11px] leading-tight text-gray-600">{label}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
        <span><span className="mr-1 inline-block h-3 w-3 rounded border border-green-200 bg-green-50 align-middle" />Present</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded border border-amber/40 bg-amber-light align-middle" />Leave</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded border border-sky/30 bg-sky-light align-middle" />Holiday</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded border border-red-200 bg-red-50 align-middle" />Absent / not marked</span>
      </div>
    </div>
  );
}

export function AttendancePage() {
  const { employee } = useMe();
  const canPick = isHR(employee) || employee.role === 'manager';
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [who, setWho] = useState(employee.id);
  const today = useLoad(() => api<AttendanceRecord | null>('/api/attendance/today'));
  const people = useLoad(() => (canPick ? api<Employee[]>('/api/employees') : Promise.resolve([] as Employee[])), [canPick]);
  const data = useLoad(() => api<MonthData>(`/api/attendance?month=${month}&employeeId=${who}`), [month, who]);
  const pickable = (people.data ?? []).filter((p) => p.id === employee.id || isHR(employee) || p.managerId === employee.id);

  const rows = (data.data?.records ?? []).slice().reverse();

  return (
    <>
      <PageHeader title="Attendance" />
      <div className="space-y-5">
        {who === employee.id && <CheckInCard record={today.data ?? null} onChange={() => { today.reload(); data.reload(); }} />}
        <Card
          title="Monthly view"
          action={
            <div className="flex flex-wrap gap-2">
              {canPick && pickable.length > 1 && (
                <Select value={who} onChange={(e) => setWho(e.target.value)} className="w-48">
                  {pickable.map((p) => <option key={p.id} value={p.id}>{p.id === employee.id ? 'Me' : p.fullName}</option>)}
                </Select>
              )}
              <Field label=""><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" /></Field>
            </div>
          }
        >
          <ErrorText error={data.error} />
          {data.data && <MonthGrid data={data.data} />}
        </Card>
        <Card title="Check-in log">
          {rows.length === 0 ? <Empty>No check-ins this month.</Empty> : (
            <Table head={['Date', 'Check in', 'Check out', 'Hours']}>
              {rows.map((r) => (
                <tr key={r.id}><Td>{r.date}</Td><Td>{fmtTime(r.checkIn)}</Td><Td>{fmtTime(r.checkOut)}</Td><Td>{hours(r)}</Td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

interface TeamRow {
  id: string;
  fullName: string;
  designation: string | null;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  leaveCode: string | null;
  offReason: string | null;
}

export function TeamTodayPage() {
  const { employee } = useMe();
  const { data, error } = useLoad(() => api<TeamRow[]>('/api/attendance/team'));
  const counts = (data ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return (
    <>
      <PageHeader title={isHR(employee) ? 'Today in office' : 'My team today'} subtitle={todayIST()} />
      <ErrorText error={error} />
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Present', (counts.present ?? 0) + (counts.checked_out ?? 0)], ['On leave', counts.on_leave ?? 0], ['Not marked', counts.not_marked ?? 0], ['Total', data.length]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-gray-200 p-4">
                <div className="text-xs text-gray-500 uppercase">{k}</div>
                <div className="font-heading text-2xl font-bold text-deep">{v}</div>
              </div>
            ))}
          </div>
          <Card>
            {data.length === 0 ? <Empty>No one reports to you yet.</Empty> : (
              <Table head={['Name', 'Status', 'Check in', 'Check out']}>
                {data.map((r) => (
                  <tr key={r.id}>
                    <Td><div className="font-medium">{r.fullName}</div><div className="text-xs text-gray-500">{r.designation}</div></Td>
                    <Td><Badge value={r.status} /> {r.leaveCode && <span className="text-xs text-gray-500">{r.leaveCode}</span>}{r.status === 'off' && <span className="ml-1 text-xs text-gray-500">{r.offReason}</span>}</Td>
                    <Td>{fmtTime(r.checkIn)}</Td>
                    <Td>{fmtTime(r.checkOut)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
