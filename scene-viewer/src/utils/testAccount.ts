import { apiLogin, apiRegister } from '@/api/miniprogram';
import { getAuthToken } from '@/utils/http';

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
    await apiLogin({ username, password });
    return;
  } catch (error) {
    console.warn('Failed to sign in test account, attempting registration', error);
  }

  try {
    await apiRegister({ username, password, displayName });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message && message.toLowerCase().includes('already exists')) {
      await apiLogin({ username, password });
      return;
    }
    console.error('Unable to register test account', error);
  }
}
