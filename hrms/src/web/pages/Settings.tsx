import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api, DAY_NAMES, isHR, type LeaveType } from '../api';
import { useMe, useSession } from '../session';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Table, Td, Textarea, useAction, useLoad } from '../components/ui';

function CompanySettings() {
  const { company, employee } = useMe();
  const { refresh } = useSession();
  const [name, setName] = useState(company.name);
  const [offs, setOffs] = useState<number[]>(company.weeklyOffs);
  const [policy, setPolicy] = useState(company.policyText);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const admin = employee.role === 'admin';

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    act.run(async () => {
      await api('/api/company', { method: 'PATCH', body: { name, weeklyOffs: offs, policyText: policy } });
      await refresh();
      setSaved(true);
    });
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Card title="Company">
        <div className="space-y-4">
          <Field label="Company name"><Input value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} className="max-w-md" /></Field>
          <div>
            <span className="mb-2 block text-sm font-medium text-gray-700">Weekly offs</span>
            <div className="flex flex-wrap gap-3">
              {DAY_NAMES.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" disabled={!admin} checked={offs.includes(i)} onChange={(e) => setOffs(e.target.checked ? [...offs, i] : offs.filter((x) => x !== i))} />
                  {d}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">Weekly offs are skipped when counting leave days. Alternate-Saturday rules come in Phase 1.</p>
          </div>
        </div>
      </Card>
      <Card title="HR policy for the assistant">
        <p className="mb-3 text-sm text-gray-600">
          Paste your leave, attendance, notice period and reimbursement policies here as plain text. The HR Assistant answers employee questions only from this text. Do not paste salary data or personal details.
        </p>
        <Textarea rows={14} disabled={!admin} value={policy} onChange={(e) => setPolicy(e.target.value)} placeholder="e.g. Casual leave: 12 days per year, cannot be carried forward..." />
        <p className="mt-1 text-xs text-gray-500">{policy.length.toLocaleString('en-IN')} / 60,000 characters</p>
      </Card>
      {admin ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={act.busy}>{act.busy ? 'Saving...' : 'Save settings'}</Button>
          {saved && <span className="text-sm text-green-700">Saved</span>}
          <ErrorText error={act.error} />
        </div>
      ) : <p className="text-sm text-gray-500">Only an admin can change company settings.</p>}
    </form>
  );
}

function LeaveTypes() {
  const { data, error, reload } = useLoad(() => api<LeaveType[]>('/api/leave/types'));
  const [f, setF] = useState({ name: '', code: '', annualQuota: '' });
  const act = useAction();

  const add = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => { await api('/api/leave/types', { body: { ...f, annualQuota: Number(f.annualQuota) } }); setF({ name: '', code: '', annualQuota: '' }); reload(); });
  };
  const update = (t: LeaveType, patch: Partial<{ annualQuota: number; active: boolean }>) =>
    act.run(async () => { await api(`/api/leave/types/${t.id}`, { method: 'PATCH', body: patch }); reload(); });

  return (
    <Card title="Leave types">
      <p className="mb-4 text-sm text-gray-600">Annual quota is credited in full on 1 January. Monthly accrual and carry-forward come in Phase 1.</p>
      <ErrorText error={error ?? act.error} />
      {data && (
        <Table head={['Leave type', 'Code', 'Days per year', 'Status', '']}>
          {data.map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.name}</Td>
              <Td>{t.code}</Td>
              <Td>
                <Input type="number" min={0} max={365} step={0.5} defaultValue={Number(t.annualQuota)} className="w-24"
                  onBlur={(e) => Number(e.target.value) !== Number(t.annualQuota) && update(t, { annualQuota: Number(e.target.value) })} />
              </Td>
              <Td><Badge value={t.active ? 'active' : 'cancelled'} /></Td>
              <Td className="text-right"><button className="text-xs text-deep hover:underline" onClick={() => update(t, { active: !t.active })}>{t.active ? 'Disable' : 'Enable'}</button></Td>
            </tr>
          ))}
        </Table>
      )}
      <form onSubmit={add} className="mt-5 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-5">
        <Field label="New leave type"><Input required placeholder="e.g. Maternity Leave" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code"><Input required maxLength={6} placeholder="ML" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="w-24" /></Field>
        <Field label="Days per year"><Input required type="number" min={0} max={365} step={0.5} value={f.annualQuota} onChange={(e) => setF({ ...f, annualQuota: e.target.value })} className="w-28" /></Field>
        <Button type="submit" disabled={act.busy}>Add</Button>
      </form>
    </Card>
  );
}

export function SettingsPage() {
  const { employee } = useMe();
  if (!isHR(employee)) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <CompanySettings />
        <LeaveTypes />
      </div>
    </>
  );
}
