import { post, setAuthToken, getAuthToken } from './http';

const DEFAULT_USERNAME = 'test';
const DEFAULT_PASSWORD = 'test1234';
const DEFAULT_DISPLAY_NAME = 'Test Account';

function resolveCredentials() {
  const username = import.meta.env?.VITE_MINI_TEST_USER || DEFAULT_USERNAME;
  const password = import.meta.env?.VITE_MINI_TEST_PASSWORD || DEFAULT_PASSWORD;
  const displayName = import.meta.env?.VITE_MINI_TEST_DISPLAY_NAME || DEFAULT_DISPLAY_NAME;
  return { username, password, displayName };
}

export async function ensureTestAccountLogin(force = false): Promise<void> {
  if (!force && getAuthToken()) {
    return;
  }

  const { username, password, displayName } = resolveCredentials();

  try {
    const session = await post('/users/login', { username, password }, false);
    if (session && session.token) {
      try {
        setAuthToken((session as any).token);
      } catch {}
    }
    return;
  } catch (error) {
    console.warn('Failed to sign in test account, attempting registration', error);
  }

  try {
    const reg = await post('/users/register', { username, password, displayName }, false);
    if (reg && (reg as any).token) {
      try {
        setAuthToken((reg as any).token);
      } catch {}
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message && message.toLowerCase().includes('already exists')) {
      await post('/users/login', { username, password }, false).then((s: any) => s && s.token && setAuthToken(s.token)).catch(() => {});
      return;
    }
    console.error('Unable to register test account', error);
  }
}
