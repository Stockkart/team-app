import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireHttpsUrl, requirePresent, webUrl } from './config';

const VAR = 'EXPO_PUBLIC_API_URL';
const GOOGLE_VAR = 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID';

describe('requireHttpsUrl', () => {
  it('returns an https URL unchanged apart from trimming and trailing slashes', () => {
    expect(requireHttpsUrl(VAR, 'https://api.example.in/api/v1')).toBe(
      'https://api.example.in/api/v1',
    );
    expect(requireHttpsUrl(VAR, '  https://api.example.in/api/v1/  ')).toBe(
      'https://api.example.in/api/v1',
    );
    expect(requireHttpsUrl(VAR, 'https://api.example.in:8443')).toBe('https://api.example.in:8443');
  });

  it.each([
    ['http://api.example.in/api/v1', 'plain http'],
    ['HTTPS://api.example.in', 'upper-case scheme'],
    ['api.example.in', 'no scheme'],
    ['https:/api.example.in', 'one slash'],
    ['https://', 'no host'],
    ['https:// api.example.in', 'space before host'],
    ['ftp://api.example.in', 'other scheme'],
  ])('rejects %s (%s)', (value) => {
    expect(() => requireHttpsUrl(VAR, value)).toThrow(/must be an https:\/\/ URL/);
  });

  it.each([undefined, '', '   '])('rejects a missing value %j', (value) => {
    expect(() => requireHttpsUrl(VAR, value)).toThrow(/EXPO_PUBLIC_API_URL is not set/);
  });

  it('names the variable in every error message', () => {
    expect(() => requireHttpsUrl('SOME_NAME', 'http://x')).toThrow(/^SOME_NAME /);
    expect(() => requireHttpsUrl('SOME_NAME', '')).toThrow(/^SOME_NAME /);
  });
});

describe('requirePresent', () => {
  it('returns a present value trimmed', () => {
    expect(requirePresent('X', '  123-abc.apps.googleusercontent.com ')).toBe(
      '123-abc.apps.googleusercontent.com',
    );
  });

  it.each([undefined, '', '   '])('rejects a missing value %j and names the variable', (value) => {
    expect(() => requirePresent('SOME_NAME', value)).toThrow(/^SOME_NAME is not set/);
  });
});

describe('webUrl (Forgot password?, R1.6)', () => {
  it('is the API URL’s origin when EXPO_PUBLIC_WEB_URL is unset or blank', () => {
    expect(webUrl(undefined, 'https://api.example.in/api/v1')).toBe('https://api.example.in');
    expect(webUrl('  ', 'https://api.example.in:8443/api/v1')).toBe('https://api.example.in:8443');
  });

  it('is the variable, trimmed and without trailing slashes, when set; https only', () => {
    expect(webUrl(' https://stockkart.example.in/ ', 'https://api.example.in/api/v1')).toBe(
      'https://stockkart.example.in',
    );
    expect(() => webUrl('http://stockkart.example.in', 'https://api.example.in')).toThrow(
      /^EXPO_PUBLIC_WEB_URL must be an https:\/\/ URL/,
    );
  });

  it('the module derives FORGOT_PASSWORD_URL from it', async () => {
    vi.stubEnv('EXPO_PUBLIC_WEB_URL', 'https://stockkart.example.in');
    vi.resetModules();
    const { FORGOT_PASSWORD_URL, WEB_URL } = await import('./config');
    expect(WEB_URL).toBe('https://stockkart.example.in');
    expect(FORGOT_PASSWORD_URL).toBe('https://stockkart.example.in/forgot-password');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('config module', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exports API_URL from EXPO_PUBLIC_API_URL when it is https', async () => {
    vi.stubEnv(VAR, 'https://api.example.in/api/v1/');
    vi.resetModules();
    const { API_URL } = await import('./config');
    expect(API_URL).toBe('https://api.example.in/api/v1');
  });

  it('exports GOOGLE_WEB_CLIENT_ID trimmed from EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', async () => {
    vi.stubEnv(GOOGLE_VAR, ' 123-abc.apps.googleusercontent.com ');
    vi.resetModules();
    const { GOOGLE_WEB_CLIENT_ID } = await import('./config');
    expect(GOOGLE_WEB_CLIENT_ID).toBe('123-abc.apps.googleusercontent.com');
  });

  it('throws at import time when EXPO_PUBLIC_API_URL is plain http', async () => {
    vi.stubEnv(VAR, 'http://api.example.in/api/v1');
    vi.resetModules();
    await expect(import('./config')).rejects.toThrow(/must be an https:\/\/ URL/);
  });

  it('throws at import time when EXPO_PUBLIC_API_URL is missing', async () => {
    vi.stubEnv(VAR, '');
    vi.resetModules();
    await expect(import('./config')).rejects.toThrow(/is not set/);
  });

  it('throws at import time when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing', async () => {
    vi.stubEnv(GOOGLE_VAR, '');
    vi.resetModules();
    await expect(import('./config')).rejects.toThrow(
      /^EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set/,
    );
  });
});
