import { post, setAuthToken, getAuthToken } from './http';
import { getHarmonyRuntime } from './runtimeConfig';

const DEFAULT_USERNAME = 'test';
const DEFAULT_PASSWORD = 'test1234';
const DEFAULT_DISPLAY_NAME = 'Test Account';

function resolveCredentials() {
  const configured = getHarmonyRuntime().http?.testAccount;
  const username = configured?.username || DEFAULT_USERNAME;
  const password = configured?.password || DEFAULT_PASSWORD;
  const displayName = configured?.displayName || DEFAULT_DISPLAY_NAME;
  return { username, password, displayName };
}

export async function ensureTestAccountLogin(force = false): Promise<void> {
  if (!force && getAuthToken()) {
    return;
  }

  const { username, password, displayName } = resolveCredentials();

  try {
    const session = await post('/mini-auth/login', { username, password }, false);
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
    const reg = await post('/mini-auth/register', { username, password, displayName }, false);
    if (reg && (reg as any).token) {
      try {
        setAuthToken((reg as any).token);
      } catch {}
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message && message.toLowerCase().includes('already exists')) {
      await post('/mini-auth/login', { username, password }, false).then((s: any) => s && s.token && setAuthToken(s.token)).catch(() => {});
      return;
    }
    console.error('Unable to register test account', error);
  }
}
