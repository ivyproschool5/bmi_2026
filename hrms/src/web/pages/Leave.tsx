import { useState, type FormEvent } from 'react';
import { api, fmtDate, fmtDays, todayIST, type Balance, type LeaveRequest } from '../api';
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Select, Table, Td, Textarea, useAction, useLoad } from '../components/ui';
import { BalanceTiles } from './Dashboard';

function ApplyLeave({ balances, onDone, onClose }: { balances: Balance[]; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({ leaveTypeId: balances[0]?.leaveTypeId ?? '', fromDate: '', toDate: '', halfDay: false, reason: '' });
  const { busy, error, run } = useAction();
  const selected = balances.find((b) => b.leaveTypeId === f.leaveTypeId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/api/leave/requests', { body: { ...f, toDate: f.halfDay ? f.fromDate : f.toDate } });
      onDone();
      onClose();
    });
  };

  return (
    <Modal title="Apply for leave" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Leave type" hint={selected ? `${selected.available} day(s) available` : undefined}>
          <Select value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })} required>
            {balances.map((b) => <option key={b.leaveTypeId} value={b.leaveTypeId}>{b.name}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked })} />
          Half day
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.halfDay ? 'Date' : 'From'}>
            <Input type="date" required value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: f.toDate && f.toDate >= e.target.value ? f.toDate : e.target.value })} />
          </Field>
          {!f.halfDay && (
            <Field label="To"><Input type="date" required min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
          )}
        </div>
        <Field label="Reason (optional)"><Textarea rows={3} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <p className="text-xs text-gray-500">Weekly offs and company holidays are not counted.</p>
        <ErrorText error={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Submit request'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function LeavePage() {
  const balances = useLoad(() => api<Balance[]>('/api/leave/balances'));
  const requests = useLoad(() => api<LeaveRequest[]>('/api/leave/requests?scope=mine'));
  const [applying, setApplying] = useState(false);
  const { error, run } = useAction();

  const reloadAll = () => { balances.reload(); requests.reload(); };
  const cancel = (id: string) => {
    if (!confirm('Cancel this leave request?')) return;
    run(async () => { await api(`/api/leave/requests/${id}/cancel`, { method: 'POST' }); reloadAll(); });
  };
  const today = todayIST();

  return (
    <>
      <PageHeader title="My Leave" action={<Button onClick={() => setApplying(true)} disabled={!balances.data?.length}>Apply for leave</Button>} />
      <div className="space-y-5">
        <Card title={`Balance for ${new Date().getFullYear()}`}>
          <ErrorText error={balances.error} />
          {balances.data && <BalanceTiles balances={balances.data} />}
        </Card>
        <Card title="My requests">
          <ErrorText error={requests.error ?? error} />
          {requests.data && requests.data.length === 0 && <Empty>You have not applied for any leave yet.</Empty>}
          {requests.data && requests.data.length > 0 && (
            <Table head={['Type', 'Dates', 'Days', 'Status', 'Decision', '']}>
              {requests.data.map((r) => (
                <tr key={r.id}>
                  <Td>{r.leaveType}</Td>
                  <Td>{fmtDate(r.fromDate)}{r.toDate !== r.fromDate && <> to {fmtDate(r.toDate)}</>}{r.halfDay && ' (half)'}</Td>
                  <Td>{fmtDays(r.days)}</Td>
                  <Td><Badge value={r.status} /></Td>
                  <Td className="text-gray-500">{r.approverName && <>{r.approverName}{r.decisionNote && <>: {r.decisionNote}</>}</>}</Td>
                  <Td className="text-right">
                    {(r.status === 'pending' || (r.status === 'approved' && r.fromDate > today)) && (
                      <button className="text-sm text-red-700 hover:underline" onClick={() => cancel(r.id)}>Cancel</button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {applying && balances.data && <ApplyLeave balances={balances.data} onDone={reloadAll} onClose={() => setApplying(false)} />}
    </>
  );
}
