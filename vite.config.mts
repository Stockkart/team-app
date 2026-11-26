/// <reference types='vitest' />
import * as path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Test-only Vite config (no `build`: the app is built by Expo and Gradle, not Vite). `pnpm test` runs
 * `vitest run` against it.
 *
 * Three projects. The third is `packages/attendance-protocol/vite.config.mts`, the app's copy of the
 * protocol package (DD21), so one `pnpm test` covers app and protocol. The first two are the app's: pure logic under `src/**` runs in node; screens under `src/screens/**`,
 * `src/account/**`, `src/join/**`, `src/home/**`, `src/modules/**` and `src/profile/**`, the
 * component kit under `src/components/**` and the navigator under `src/navigation/**` run in jsdom
 * with `react-native` aliased to `test-support/react-native-dom.tsx` (plain DOM elements) and
 * `expo-linear-gradient` to `test-support/expo-linear-gradient.tsx`, so `@testing-library/react`
 * can render and tap them. `src/i18n/pseudo.test.tsx` renders every screen
 * too and opts into jsdom with a `@vitest-environment` docblock. Modules that touch Expo APIs are
 * mocked in their tests; the navigator tests replace `@react-navigation/*` with
 * `test-support/fake-navigation.tsx`.
 */
const RENDERED = [
  'src/screens/**',
  'src/components/**',
  'src/navigation/**',
  'src/account/**',
  'src/join/**',
  'src/home/**',
  'src/modules/**',
  'src/profile/**',
];

export default defineConfig({
  cacheDir: 'node_modules/.vite/stockkart-team',
  esbuild: { jsx: 'automatic' },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'react-native': path.resolve(__dirname, 'test-support/react-native-dom.tsx'),
      // Native module (the Home gradient band): a DOM shim that records the colours it was given.
      'expo-linear-gradient': path.resolve(__dirname, 'test-support/expo-linear-gradient.tsx'),
    },
  },
  test: {
    name: 'stockkart-team',
    watch: false,
    globals: false,
    reporters: ['default'],
    env: {
      // `src/config.ts` throws on import without an https:// URL and a Google client id. Tests of
      // those rules override these values with `vi.stubEnv`.
      EXPO_PUBLIC_API_URL: 'https://api.test.invalid/api/v1',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    },
    projects: [
      'packages/*/vite.config.mts',
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{ts,tsx}', 'plugins/*.test.mjs', 'app.config.test.mjs'],
          exclude: [...configDefaults.exclude, ...RENDERED],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: RENDERED.map((dir) => `${dir}/*.{test,spec}.{ts,tsx}`),
        },
      },
    ],
  },
});
