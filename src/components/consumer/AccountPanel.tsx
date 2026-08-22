import { useState } from 'react';
import { UserCircle, LogOut, Trash2, Upload, MailCheck } from 'lucide-react';

import { useNadaStore } from '@/store/useNadaStore';
import { translations } from '@/utils/translations';
import { register, signIn, signOut, deleteAccount, isSignedIn } from '@/services/accountService';
import { syncPendingReports } from '@/services/feedbackSync';
import { declaredRegion, mayShareReports } from '@/services/policyService';
import { feedbackService } from '@/services/feedbackService';

// =============================================================================
// Cuenta
//
// La cuenta existe por una sola razon, y conviene decirla donde el usuario la
// lea: sin ella no se puede defender el corpus de quien lo quiera envenenar.
// Quien quiera que NADA deje de detectar su estafa solo tiene que mandar mil
// reportes diciendo que esos mensajes eran legitimos; con cuenta verificada,
// mil reportes son mil buzones.
//
// Por eso NO hace falta cuenta para usar la app: solo para contribuir. La
// proteccion funciona igual sin registrarse, y la pantalla lo dice.
// =============================================================================

type Mode = 'signin' | 'register';

export function AccountPanel() {
  const { language } = useNadaStore();
  const t = translations[language];

  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    if (mode === 'register') {
      const result = await register(email, password, declaredRegion());
      setBusy(false);
      if (result.ok) setMessage(t.accountCheckEmail);
      else setError(result.error);
      return;
    }

    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSignedIn(true);
    setPassword('');
    setMessage(result.account.verified ? null : t.accountNotVerified);
    // Entrar es el momento natural para vaciar lo que estuviera esperando.
    void syncPendingReports();
  };

  const send = async () => {
    setBusy(true);
    const outcome = await syncPendingReports();
    setBusy(false);

    if (outcome.skipped === 'no-consent') setError(t.accountNeedsConsent);
    else if (outcome.skipped === 'nothing-to-send') setMessage(t.accountNothingPending);
    else setMessage(t.accountSent.replace('{n}', String(outcome.sent)));
  };

  const leave = async () => {
    await signOut();
    setSignedIn(false);
    setMessage(null);
  };

  const remove = async () => {
    setBusy(true);
    const result = await deleteAccount();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // El borrado del servidor se lleva los reportes ya enviados; la cola local
    // se vacia aqui para que no queden restos en el dispositivo.
    await feedbackService.clear();
    setSignedIn(false);
    setMessage(t.accountDeleted);
  };

  return (
    <div className="card p-4 space-y-3">
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
        <UserCircle className="w-4 h-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        {t.accountTitle}
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t.accountWhy}
      </p>

      {signedIn ? (
        <div className="space-y-2">
          {!mayShareReports() && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>{t.accountNeedsConsent}</p>
          )}
          <button
            type="button" disabled={busy} onClick={() => void send()}
            className="w-full text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
          >
            <Upload className="w-3 h-3" aria-hidden="true" />
            {t.accountSendPending}
          </button>
          <button
            type="button" disabled={busy} onClick={() => void leave()}
            className="w-full text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <LogOut className="w-3 h-3" aria-hidden="true" />
            {t.accountSignOut}
          </button>
          <button
            type="button" disabled={busy} onClick={() => void remove()}
            className="w-full text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: 'var(--dangerous-bg)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            {t.accountDelete}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={t.accountEmail} autoComplete="email"
            className="w-full text-xs rounded-lg p-2"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={t.accountPassword}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            className="w-full text-xs rounded-lg p-2"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <button
            type="button" disabled={busy || !email || !password} onClick={() => void submit()}
            className="w-full text-xs font-bold py-2 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--bg-base)' }}
          >
            {mode === 'register' ? t.accountRegister : t.accountSignIn}
          </button>
          <button
            type="button"
            onClick={() => { setMode(mode === 'register' ? 'signin' : 'register'); setError(null); setMessage(null); }}
            className="w-full text-[11px] underline"
            style={{ color: 'var(--text-muted)' }}
          >
            {mode === 'register' ? t.accountHaveOne : t.accountNeedOne}
          </button>
        </div>
      )}

      {message && (
        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--success)' }}>
          <MailCheck className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
