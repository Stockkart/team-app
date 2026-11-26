import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const appConfig = require('./app.config.js');

const BASE = {
  name: 'Stockkart Team',
  version: '0.1.0',
  android: { versionCode: 1, package: 'p' },
};

describe('app.config.js version overrides', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the app.json values when neither variable is set', () => {
    vi.stubEnv('APP_VERSION_CODE', '');
    vi.stubEnv('APP_VERSION_NAME', '');
    expect(appConfig({ config: BASE })).toEqual(BASE);
  });

  it('overrides versionCode and version when both are set', () => {
    vi.stubEnv('APP_VERSION_CODE', '1042');
    vi.stubEnv('APP_VERSION_NAME', '1.0.0-test');
    const config = appConfig({ config: BASE });
    expect(config.android).toEqual({ versionCode: 1042, package: 'p' });
    expect(config.version).toBe('1.0.0-test');
  });

  it.each(['0', '1.5', 'abc', '-3', '2100000001'])('refuses APP_VERSION_CODE=%s', (value) => {
    vi.stubEnv('APP_VERSION_CODE', value);
    expect(() => appConfig({ config: BASE })).toThrow(/APP_VERSION_CODE must be an integer/);
  });

  it('still refuses a non-https API URL', () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://api.example.in/api/v1');
    expect(() => appConfig({ config: BASE })).toThrow(/must be an https:\/\/ URL/);
  });
});
