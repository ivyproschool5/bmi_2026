import { useState, type FormEvent } from 'react';
import { api, fmtDate, isHR, type Holiday } from '../api';
import { useMe } from '../session';
import { Button, Card, Empty, ErrorText, Field, Input, PageHeader, Select, Table, Td, useAction, useLoad } from '../components/ui';

export function HolidaysPage() {
  const { employee } = useMe();
  const hr = isHR(employee);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, error, reload } = useLoad(() => api<Holiday[]>(`/api/holidays?year=${year}`), [year]);
  const [f, setF] = useState({ date: '', name: '' });
  const act = useAction();

  const add = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => { await api('/api/holidays', { body: f }); setF({ date: '', name: '' }); reload(); });
  };
  const remove = (h: Holiday) => confirm(`Remove ${h.name}?`) && act.run(async () => { await api(`/api/holidays/${h.id}`, { method: 'DELETE' }); reload(); });

  return (
    <>
      <PageHeader
        title="Holidays"
        action={
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        }
      />
      <div className="space-y-5">
        {hr && (
          <Card title="Add a holiday">
            <form onSubmit={add} className="flex flex-wrap items-end gap-3">
              <Field label="Date"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label="Name"><Input required placeholder="e.g. Diwali" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-60" /></Field>
              <Button type="submit" disabled={act.busy}>Add</Button>
            </form>
            <div className="mt-3"><ErrorText error={act.error} /></div>
          </Card>
        )}
        <Card title={`${year} holiday list`}>
          <ErrorText error={error} />
          {data?.length === 0 && <Empty>No holidays added for {year}.</Empty>}
          {!!data?.length && (
            <Table head={['Date', 'Day', 'Holiday', '']}>
              {data.map((h) => (
                <tr key={h.id}>
                  <Td>{fmtDate(h.date)}</Td>
                  <Td>{new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' })}</Td>
                  <Td className="font-medium">{h.name}</Td>
                  <Td className="text-right">{hr && <button onClick={() => remove(h)} className="text-xs text-red-700 hover:underline">Remove</button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
