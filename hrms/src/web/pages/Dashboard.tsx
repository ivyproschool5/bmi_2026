import { Link } from 'react-router-dom';
import { api, fmtDate, fmtTime, isHR, type AttendanceRecord, type Balance, type Holiday } from '../api';
import { useMe } from '../session';
import { Button, Card, Empty, ErrorText, PageHeader, useAction, useLoad } from '../components/ui';

interface Dashboard {
  today: string;
  attendance: AttendanceRecord | null;
  balances: Balance[];
  pendingApprovals: number;
  onLeaveToday: { name: string; code: string; toDate: string; halfDay: boolean }[];
  upcomingHolidays: Holiday[];
  headcount: number;
}

export function BalanceTiles({ balances }: { balances: Balance[] }) {
  if (!balances.length) return <Empty>No leave types set up yet.</Empty>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {balances.map((b) => (
        <div key={b.leaveTypeId} className="rounded-md border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 uppercase">{b.name}</div>
          <div className="mt-1 font-heading text-2xl font-bold text-deep">{b.available}</div>
          <div className="text-xs text-gray-500">
            of {b.quota} available · {b.taken} taken{b.pending ? ` · ${b.pending} pending` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CheckInCard({ record, onChange }: { record: AttendanceRecord | null; onChange: () => void }) {
  const { busy, error, run } = useAction();
  const act = (path: string) => run(async () => { await api(path, { method: 'POST' }); onChange(); });
  return (
    <Card title="Today's attendance">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-gray-600">
          {!record?.checkIn && 'You have not checked in yet.'}
          {record?.checkIn && <>Checked in at <b>{fmtTime(record.checkIn)}</b></>}
          {record?.checkOut && <>, checked out at <b>{fmtTime(record.checkOut)}</b></>}
        </div>
        {!record?.checkIn && <Button disabled={busy} onClick={() => act('/api/attendance/check-in')}>Check in</Button>}
        {record?.checkIn && !record.checkOut && <Button variant="secondary" disabled={busy} onClick={() => act('/api/attendance/check-out')}>Check out</Button>}
        {record?.checkOut && <span className="text-sm font-medium text-green-700">Day complete</span>}
      </div>
      <div className="mt-3"><ErrorText error={error} /></div>
    </Card>
  );
}

export function DashboardPage() {
  const { employee } = useMe();
  const { data, error, reload } = useLoad(() => api<Dashboard>('/api/dashboard'));
  const isApprover = isHR(employee) || employee.role === 'manager';

  return (
    <>
      <PageHeader title={`Hello, ${employee.fullName.split(' ')[0]}`} subtitle={data ? fmtDate(data.today) : undefined} />
      <ErrorText error={error} />
      {data && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <CheckInCard record={data.attendance} onChange={reload} />
            <Card title="My leave balance" action={<Link to="/leave" className="text-sm font-medium text-sky hover:underline">Apply for leave</Link>}>
              <BalanceTiles balances={data.balances} />
            </Card>
          </div>
          <div className="space-y-5">
            {isApprover && (
              <Card title="Waiting for your approval">
                <div className="flex items-center justify-between">
                  <span className="font-heading text-3xl font-bold text-deep">{data.pendingApprovals}</span>
                  <Link to="/approvals" className="text-sm font-medium text-sky hover:underline">Review</Link>
                </div>
              </Card>
            )}
            {isHR(employee) && (
              <Card title="Active employees">
                <div className="flex items-center justify-between">
                  <span className="font-heading text-3xl font-bold text-deep">{data.headcount}</span>
                  <Link to="/team" className="text-sm font-medium text-sky hover:underline">Today in office</Link>
                </div>
              </Card>
            )}
            <Card title="On leave today">
              {data.onLeaveToday.length ? (
                <ul className="space-y-2 text-sm">
                  {data.onLeaveToday.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{l.name}</span>
                      <span className="text-gray-500">{l.halfDay ? 'Half day' : `till ${fmtDate(l.toDate)}`}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">Everyone is in today.</p>}
            </Card>
            <Card title="Upcoming holidays">
              {data.upcomingHolidays.length ? (
                <ul className="space-y-2 text-sm">
                  {data.upcomingHolidays.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2"><span>{h.name}</span><span className="text-gray-500">{fmtDate(h.date)}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">No holidays listed.</p>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

