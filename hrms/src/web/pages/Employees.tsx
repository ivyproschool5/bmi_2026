import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, isHR, type Doc, type Employee, type Role } from '../api';
import { useMe } from '../session';
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Select, Table, Td, useAction, useLoad } from '../components/ui';
import { ChangePasswordPage } from './Auth';

type Form = { fullName: string; email: string; employeeCode: string; designation: string; department: string; managerId: string; role: Role; dateOfJoining: string; status?: 'active' | 'exited' };
const emptyForm: Form = { fullName: '', email: '', employeeCode: '', designation: '', department: '', managerId: '', role: 'employee', dateOfJoining: '' };

function EmployeeForm({ initial, people, editing, onClose, onSaved }: { initial: Form; people: Employee[]; editing?: Employee; onClose: () => void; onSaved: (tempPassword?: string) => void }) {
  const { employee: me } = useMe();
  const [f, setF] = useState<Form>(initial);
  const { busy, error, run } = useAction();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const roleOptions: Role[] = me.role === 'admin' ? ['employee', 'manager', 'hr', 'admin'] : ['employee', 'manager'];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const body = { ...f, managerId: f.managerId || null, dateOfJoining: f.dateOfJoining || null };
      if (editing) {
        const { email: _e, ...patch } = body;
        await api(`/api/employees/${editing.id}`, { method: 'PATCH', body: patch });
        onSaved();
      } else {
        const res = await api<{ tempPassword: string }>('/api/employees', { body });
        onSaved(res.tempPassword);
      }
    });
  };

  return (
    <Modal title={editing ? 'Edit employee' : 'Add employee'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input required value={f.fullName} onChange={set('fullName')} /></Field>
          <Field label="Work email"><Input type="email" required disabled={!!editing} value={f.email} onChange={set('email')} /></Field>
          <Field label="Employee code"><Input value={f.employeeCode} onChange={set('employeeCode')} /></Field>
          <Field label="Date of joining"><Input type="date" value={f.dateOfJoining} onChange={set('dateOfJoining')} /></Field>
          <Field label="Designation"><Input value={f.designation} onChange={set('designation')} /></Field>
          <Field label="Department"><Input value={f.department} onChange={set('department')} /></Field>
          <Field label="Reports to">
            <Select value={f.managerId} onChange={set('managerId')}>
              <option value="">No manager</option>
              {people.filter((p) => p.id !== editing?.id && p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Access level">
            <Select value={f.role} onChange={set('role')} disabled={editing?.id === me.id || (!roleOptions.includes(f.role))}>
              {(roleOptions.includes(f.role) ? roleOptions : [f.role, ...roleOptions]).map((r) => <option key={r} value={r}>{r === 'hr' ? 'HR' : r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </Select>
          </Field>
          {editing && editing.id !== me.id && (
            <Field label="Status">
              <Select value={f.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="exited">Exited (blocks login)</option>
              </Select>
            </Field>
          )}
        </div>
        <ErrorText error={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save' : 'Add employee'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function TempPasswordNotice({ password, onClose }: { password: string; onClose: () => void }) {
  return (
    <Modal title="Login created" onClose={onClose}>
      <p className="text-sm text-gray-600">Share this temporary password with the employee privately. It is shown only once. They will be asked to set their own password at first login.</p>
      <div className="my-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-center font-mono text-lg tracking-wider select-all">{password}</div>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(password)}>Copy</Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

export function EmployeesPage() {
  const { employee: me } = useMe();
  const hr = isHR(me);
  const [showExited, setShowExited] = useState(false);
  const { data, error, reload } = useLoad(() => api<Employee[]>(`/api/employees${showExited ? '?all=1' : ''}`), [showExited]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const byId = useMemo(() => new Map((data ?? []).map((e) => [e.id, e])), [data]);
  const list = (data ?? []).filter((e) => `${e.fullName} ${e.email} ${e.department ?? ''} ${e.designation ?? ''} ${e.employeeCode ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Employees" subtitle={data ? `${data.filter((e) => e.status === 'active').length} active` : undefined} action={hr && <Button onClick={() => setAdding(true)}>Add employee</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <Input placeholder="Search by name, email, department..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          {hr && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} /> Show exited
            </label>
          )}
        </div>
        <ErrorText error={error} />
        {data && list.length === 0 && <Empty>No employees match.</Empty>}
        {list.length > 0 && (
          <Table head={['Name', 'Designation', 'Department', 'Reports to', 'Access']}>
            {list.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <Td>
                  <Link to={`/employees/${e.id}`} className="font-medium text-deep hover:underline">{e.fullName}</Link>
                  <div className="text-xs text-gray-500">{e.email}</div>
                </Td>
                <Td>{e.designation}</Td>
                <Td>{e.department}</Td>
                <Td>{e.managerId ? byId.get(e.managerId)?.fullName : ''}</Td>
                <Td><Badge value={e.status === 'exited' ? 'exited' : e.role} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {adding && data && (
        <EmployeeForm initial={emptyForm} people={data} onClose={() => setAdding(false)} onSaved={(pw) => { setAdding(false); reload(); if (pw) setTemp(pw); }} />
      )}
      {temp && <TempPasswordNotice password={temp} onClose={() => setTemp(null)} />}
    </>
  );
}

export function Documents({ employeeId, canDelete }: { employeeId: string; canDelete: boolean }) {
  const { data, error, reload } = useLoad(() => api<Doc[]>(`/api/documents?employeeId=${employeeId}`), [employeeId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const act = useAction();

  const upload = (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return act.setError('Choose a file first');
    const form = new FormData();
    form.set('file', file);
    form.set('employeeId', employeeId);
    if (name.trim()) form.set('name', name.trim());
    act.run(async () => {
      await api('/api/documents', { form });
      setName('');
      if (fileRef.current) fileRef.current.value = '';
      reload();
    });
  };
  const remove = (id: string) => confirm('Delete this document?') && act.run(async () => { await api(`/api/documents/${id}`, { method: 'DELETE' }); reload(); });

  return (
    <Card title="Documents">
      <p className="mb-4 text-xs text-gray-500">
        Visible only to the employee and HR. For Aadhaar, upload a masked copy (last 4 digits only). PDF, JPG, PNG, WEBP or DOCX, up to 10 MB.
      </p>
      <form onSubmit={upload} className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Document name"><Input placeholder="e.g. PAN card, Offer letter" value={name} onChange={(e) => setName(e.target.value)} className="w-56" /></Field>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" className="text-sm" />
        <Button type="submit" disabled={act.busy}>{act.busy ? 'Uploading...' : 'Upload'}</Button>
      </form>
      <ErrorText error={error ?? act.error} />
      {data?.length === 0 && <Empty>No documents uploaded.</Empty>}
      {!!data?.length && (
        <ul className="divide-y divide-gray-100">
          {data.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <a href={`/api/documents/${d.id}/download`} className="font-medium text-deep hover:underline">{d.name}</a>
                <span className="ml-2 text-xs text-gray-500">{(d.size / 1024).toFixed(0)} KB · {fmtDate(d.createdAt)}</span>
              </div>
              {canDelete && <button onClick={() => remove(d.id)} className="text-xs text-red-700 hover:underline">Delete</button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProfileCard({ e, managerName }: { e: Employee; managerName?: string }) {
  const rows: [string, string | null | undefined][] = [
    ['Email', e.email], ['Employee code', e.employeeCode], ['Designation', e.designation], ['Department', e.department],
    ['Reports to', managerName], ['Date of joining', fmtDate(e.dateOfJoining)],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}><dt className="text-xs text-gray-500 uppercase">{k}</dt><dd className="text-sm">{v || '-'}</dd></div>
      ))}
    </dl>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { employee: me } = useMe();
  const hr = isHR(me);
  const emp = useLoad(() => api<Employee>(`/api/employees/${id}`), [id]);
  const people = useLoad(() => api<Employee[]>('/api/employees?all=1'));
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const reset = useAction();
  const e = emp.data;
  const manager = people.data?.find((p) => p.id === e?.managerId);
  const canEditThis = hr && e && (me.role === 'admin' || (e.role !== 'admin' && e.role !== 'hr'));

  return (
    <>
      <ErrorText error={emp.error} />
      {e && (
        <>
          <PageHeader
            title={e.fullName}
            subtitle={[e.designation, e.department].filter(Boolean).join(', ')}
            action={canEditThis && (
              <div className="flex gap-2">
                {e.id !== me.id && e.hasLogin && (
                  <Button variant="secondary" disabled={reset.busy} onClick={() => confirm(`Reset password for ${e.fullName}? They will be signed out.`) && reset.run(async () => setTemp((await api<{ tempPassword: string }>(`/api/employees/${e.id}/reset-password`, { method: 'POST' })).tempPassword))}>
                    Reset password
                  </Button>
                )}
                <Button onClick={() => setEditing(true)}>Edit</Button>
              </div>
            )}
          />
          <div className="space-y-5">
            <ErrorText error={reset.error} />
            <Card title="Profile" action={<Badge value={e.status === 'exited' ? 'exited' : e.role} />}>
              <ProfileCard e={e} managerName={manager?.fullName} />
            </Card>
            {(hr || e.id === me.id) && <Documents employeeId={e.id} canDelete={hr} />}
          </div>
          {editing && people.data && (
            <EmployeeForm
              editing={e}
              people={people.data}
              initial={{
                fullName: e.fullName, email: e.email, employeeCode: e.employeeCode ?? '', designation: e.designation ?? '', department: e.department ?? '',
                managerId: e.managerId ?? '', role: e.role, dateOfJoining: e.dateOfJoining ?? '', status: e.status,
              }}
              onClose={() => setEditing(false)}
              onSaved={() => { setEditing(false); emp.reload(); people.reload(); }}
            />
          )}
          {temp && <TempPasswordNotice password={temp} onClose={() => setTemp(null)} />}
        </>
      )}
    </>
  );
}

export function ProfilePage() {
  const { employee: me } = useMe();
  const people = useLoad(() => api<Employee[]>('/api/employees'));
  const [done, setDone] = useState(false);
  return (
    <>
      <PageHeader title="My Profile" subtitle={[me.designation, me.department].filter(Boolean).join(', ')} />
      <div className="space-y-5">
        <Card title="Details" action={<Badge value={me.role} />}>
          <ProfileCard e={me} managerName={people.data?.find((p) => p.id === me.managerId)?.fullName} />
          <p className="mt-4 text-xs text-gray-500">To correct any detail, contact HR.</p>
        </Card>
        <Documents employeeId={me.id} canDelete={isHR(me)} />
        <Card title="Change password">
          {done ? <p className="text-sm text-green-700">Password changed.</p> : <div className="max-w-sm"><ChangePasswordPage onDone={() => setDone(true)} /></div>}
        </Card>
      </div>
    </>
  );
}
