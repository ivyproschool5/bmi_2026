import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Card, ErrorText, Input, PageHeader, useAction } from '../components/ui';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = ['How many casual leaves do I have left?', 'What is the notice period?', 'When is the next holiday?', 'Can I carry forward earned leave?'];

export function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const { busy, error, run } = useAction();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);

  const ask = (question: string) => {
    if (!question.trim() || busy) return;
    const history = messages;
    setMessages([...history, { role: 'user', content: question }]);
    setQ('');
    run(async () => {
      const { answer } = await api<{ answer: string }>('/api/assistant', { body: { question, history } });
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    });
  };

  return (
    <>
      <PageHeader title="HR Assistant" subtitle="Answers come from your company's HR policy and your own leave data. Check with HR before acting on anything important." />
      <Card>
        <div className="flex h-[60vh] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <div className="py-8 text-center">
                <p className="mb-4 text-sm text-gray-500">Try asking:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-deep hover:bg-sky-light">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-sky text-white' : 'bg-gray-100 text-gray-800'}`}>{m.content}</div>
              </div>
            ))}
            {busy && <div className="text-sm text-gray-500">Thinking...</div>}
            <div ref={endRef} />
          </div>
          <ErrorText error={error} />
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); ask(q); }} className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about leave, holidays or policy..." maxLength={1000} />
            <Button type="submit" disabled={busy || !q.trim()}>Ask</Button>
          </form>
        </div>
      </Card>
    </>
  );
}
