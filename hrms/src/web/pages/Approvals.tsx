import { useState } from 'react';
import { api, fmtDate, fmtDays, isHR, type LeaveRequest } from '../api';
import { useMe } from '../session';
import { Badge, Button, Card, Empty, ErrorText, Field, Modal, PageHeader, Select, Table, Td, Textarea, useAction, useLoad } from '../components/ui';

function Decide({ req, action, onClose, onDone }: { req: LeaveRequest; action: 'approve' | 'reject'; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal title={action === 'approve' ? 'Approve leave' : 'Reject leave'} onClose={onClose}>
      <p className="mb-4 text-sm text-gray-600">
        {req.employeeName}: {req.leaveType}, {fmtDate(req.fromDate)}{req.toDate !== req.fromDate && <> to {fmtDate(req.toDate)}</>} ({fmtDays(req.days)})
      </p>
      <Field label={action === 'reject' ? 'Reason for rejecting (required)' : 'Note (optional)'}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-4"><ErrorText error={error} /></div>
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button
          variant={action === 'reject' ? 'danger' : 'primary'}
          disabled={busy || (action === 'reject' && !note.trim())}
          onClick={() => run(async () => { await api(`/api/leave/requests/${req.id}/decision`, { body: { action, note } }); onDone(); onClose(); })}
        >
          {action === 'approve' ? 'Approve' : 'Reject'}
        </Button>
      </div>
    </Modal>
  );
}

export function ApprovalsPage() {
  const { employee } = useMe();
  const hr = isHR(employee);
  const pending = useLoad(() => api<LeaveRequest[]>('/api/leave/requests?scope=approvals'));
  const [status, setStatus] = useState('');
  const all = useLoad(() => (hr ? api<LeaveRequest[]>(`/api/leave/requests?scope=all${status ? `&status=${status}` : ''}`) : Promise.resolve([])), [status, hr]);
  const [deciding, setDeciding] = useState<{ req: LeaveRequest; action: 'approve' | 'reject' } | null>(null);

  return (
    <>
      <PageHeader title="Approvals" subtitle={hr ? 'Pending leave across the company' : 'Pending leave from your direct reports'} />
      <div className="space-y-5">
        <Card title="Pending">
          <ErrorText error={pending.error} />
          {pending.data?.length === 0 && <Empty>Nothing waiting for you.</Empty>}
          {!!pending.data?.length && (
            <Table head={['Employee', 'Type', 'Dates', 'Days', 'Reason', '']}>
              {pending.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.employeeName}</Td>
                  <Td>{r.leaveCode}</Td>
                  <Td>{fmtDate(r.fromDate)}{r.toDate !== r.fromDate && <> to {fmtDate(r.toDate)}</>}</Td>
                  <Td>{fmtDays(r.days)}</Td>
                  <Td className="max-w-xs text-gray-600">{r.reason}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <Button className="px-3 py-1" onClick={() => setDeciding({ req: r, action: 'approve' })}>Approve</Button>
                      <Button className="px-3 py-1" variant="danger" onClick={() => setDeciding({ req: r, action: 'reject' })}>Reject</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {hr && (
          <Card
            title="All leave requests"
            action={
              <div className="w-40">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </div>
            }
          >
            <ErrorText error={all.error} />
            {all.data?.length === 0 && <Empty>No requests.</Empty>}
            {!!all.data?.length && (
              <Table head={['Employee', 'Type', 'Dates', 'Days', 'Status', 'Decided by']}>
                {all.data.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.employeeName}</Td>
                    <Td>{r.leaveCode}</Td>
                    <Td>{fmtDate(r.fromDate)}{r.toDate !== r.fromDate && <> to {fmtDate(r.toDate)}</>}</Td>
                    <Td>{fmtDays(r.days)}</Td>
                    <Td><Badge value={r.status} /></Td>
                    <Td className="text-gray-500">{r.approverName}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
      {deciding && <Decide {...deciding} onClose={() => setDeciding(null)} onDone={() => { pending.reload(); all.reload(); }} />}
    </>
  );
}
