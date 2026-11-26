import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '@/lib/api';
import { Button, Field } from '@/components/ui';
import { Logo } from '@/components/Layout';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card flex w-full max-w-sm flex-col gap-4 p-7">
        <div className="-ml-3">
          <Logo />
        </div>
        <div>
          <h1 className="m-0 text-xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the admin email and password from your .env file.</p>
        </div>
        <Field label="Email">
          <input className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="inp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="m-0 text-sm text-[#B91C1C]">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
