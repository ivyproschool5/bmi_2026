import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { Button, ErrorText, Field, Input, useAction } from '../components/ui';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="flex justify-end p-5">
        <span className="font-heading text-xl font-bold text-deep">
          Ivy <span className="text-sky">HRMS</span>
        </span>
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pt-8 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 mb-6 text-sm text-gray-500">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/api/auth/sign-in/email', { body: { email: email.trim().toLowerCase(), password } });
      await refresh();
    });
  };

  return (
    <AuthShell title="Sign in" subtitle="Use the email and password your HR team shared with you.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in...' : 'Sign in'}</Button>
      </form>
      <p className="mt-6 text-sm text-gray-500">
        Setting up HRMS for your company? <Link to="/signup" className="font-medium text-sky hover:underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const { refresh } = useSession();
  const [f, setF] = useState({ name: '', email: '', password: '', companyName: '' });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/api/auth/sign-up/email', { body: { name: f.name.trim(), email: f.email.trim().toLowerCase(), password: f.password } });
      await api('/api/onboard', { body: { companyName: f.companyName } });
      await refresh();
    });
  };

  return (
    <AuthShell title="Set up your company" subtitle="You will be the admin. You can add employees after this.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company name"><Input required value={f.companyName} onChange={set('companyName')} /></Field>
        <Field label="Your full name"><Input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Work email"><Input type="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label="Password" hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Creating...' : 'Create company'}</Button>
      </form>
      <p className="mt-6 text-sm text-gray-500">
        Already have an account? <Link to="/login" className="font-medium text-sky hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}

/** Logged in but not linked to a company yet (e.g. sign-up finished but onboarding failed). */
export function OnboardPage() {
  const { me, refresh, signOut } = useSession();
  const [companyName, setCompanyName] = useState('');
  const { busy, error, run } = useAction();

  if (!me?.signupAllowed) {
    return (
      <AuthShell title="No employee profile" subtitle="Your login is not linked to any company. Please contact your HR team.">
        <Button variant="secondary" onClick={signOut}>Sign out</Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Name your company" subtitle={`Signed in as ${me.user.email}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api('/api/onboard', { body: { companyName } });
            await refresh();
          });
        }}
        className="space-y-4"
      >
        <Field label="Company name"><Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>
        <ErrorText error={error} />
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>Continue</Button>
          <Button type="button" variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </form>
    </AuthShell>
  );
}

export function ChangePasswordPage({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { refresh, signOut } = useSession();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError('The new passwords do not match');
    if (next === cur) return setError('Choose a password different from the temporary one');
    run(async () => {
      await api('/api/auth/change-password', { body: { currentPassword: cur, newPassword: next, revokeOtherSessions: true } });
      await api('/api/me/password-changed', { body: {} });
      await refresh();
      onDone?.();
    });
  };

  const form = (
    <form onSubmit={submit} className="space-y-4">
      <Field label={forced ? 'Temporary password' : 'Current password'}><Input type="password" required autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password" hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Confirm new password"><Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <ErrorText error={error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</Button>
        {forced && <Button type="button" variant="ghost" onClick={signOut}>Sign out</Button>}
      </div>
    </form>
  );
  if (!forced) return form;
  return <AuthShell title="Set your own password" subtitle="You signed in with a temporary password. Please choose a new one to continue.">{form}</AuthShell>;
}
