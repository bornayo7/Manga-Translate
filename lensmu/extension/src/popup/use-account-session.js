import { useEffect, useState } from 'react';
import { sendRuntimeMessage } from './runtime.js';

export function useAccountSession() {
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    sendRuntimeMessage({ action: 'GET_AUTH_STATE' }).then((answer) => {
      if (active && answer?.isAuthenticated) setUser(answer.user);
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  async function run(action) {
    setBusy(true); setError('');
    try {
      const answer = await sendRuntimeMessage({ action });
      if (answer?.success !== true) throw new Error(answer?.error || 'The account action did not complete. Try again.');
      setUser(action === 'AUTH_LOGIN' ? answer.user : null);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return { user, busy, error, login: () => run('AUTH_LOGIN'), logout: () => run('AUTH_LOGOUT') };
}
