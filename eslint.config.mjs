import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Standalone ESLint config of the Stockkart Team app (worker-app D17, DD21). Ported from the
 * monorepo's `apps/attendance/eslint.config.mjs` with every rule kept, minus the Nx module-boundary
 * machinery (`@nx/eslint-plugin`, `enforce-module-boundaries`, project tags): a one-app repository
 * has nothing to bound. The base rule set below (`@eslint/js` recommended, `typescript-eslint`
 * recommended with the Nx-era overrides, `react`, `react-hooks`, `jsx-a11y`, Prettier last) is what
 * `nx.configs['flat/base' | 'flat/typescript' | 'flat/javascript' | 'flat/react']` spread in the
 * monorepo.
 *
 * Worker-app rules (design "Design language", task 12.3):
 * - `react/jsx-no-literals` — no text literal reaches a screen except through `t()` from
 *   `src/i18n` (R12.11, R12.12). Children only (`ignoreProps`): enum-like props such as
 *   `accessibilityRole="button"` or `variant="secondary"` are not text. The text-bearing props
 *   (`label`, `accessibilityLabel`, `placeholder`, …) are covered by the `TEXT_PROP_LITERAL`
 *   selector below instead.
 * - `no-restricted-syntax` — no hex or `rgb(`/`rgba(` colour literal outside `src/theme/tokens.ts`
 *   (R12.1): screens and components read colours through `useTheme()`.
 * - `no-restricted-imports` — `expo-haptics` only from `src/theme/haptics.ts` (R12.8),
 *   `expo-linear-gradient` only from `src/components/GradientHeader.tsx` (design "Home header",
 *   R12.16) and `@react-native-async-storage/*` nowhere (R9.2: account data lives in
 *   `expo-secure-store`), next to the bans on the web monorepo's ui-kit, api-client and shell
 *   (and, since D17, on every `@inventory-platform/*` package).
 * - `no-restricted-syntax` — the `adjustsFontSizeToFit` JSX attribute only in
 *   `src/components/PunchButton.tsx` (R7.10, R12.2): every other label wraps or grows (R12.11).
 *
 * Tests (`*.test.ts(x)`) and `test-support/**` are exempt from the literal rules: they assert on
 * texts and colours by value. The import bans apply to them too.
 *
 * `packages/attendance-protocol` is linted by this config as well (plain TypeScript rules only: the
 * `src/` globs below are relative to this file and do not reach the sources under `packages/`).
 */

const ALL_FILES = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.cts',
  '**/*.mts',
  '**/*.js',
  '**/*.jsx',
  '**/*.cjs',
  '**/*.mjs',
];

/** What `nx.configs['flat/typescript']` and `['flat/javascript']` added on top of the recommended sets. */
const NX_ERA_TS_RULES = {
  '@typescript-eslint/explicit-member-accessibility': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/adjacent-overload-signatures': 'error',
  '@typescript-eslint/prefer-namespace-keyword': 'error',
  'no-empty-function': 'off',
  '@typescript-eslint/no-empty-function': 'error',
  '@typescript-eslint/no-inferrable-types': 'error',
  '@typescript-eslint/no-empty-interface': 'error',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-require-imports': 'off',
  '@typescript-eslint/no-namespace': 'error',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
  '@typescript-eslint/no-unused-expressions': [
    'error',
    { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
  ],
  // tsc handles these.
  'no-undef': 'off',
  'no-dupe-class-members': 'off',
};

/** What `nx.configs['flat/react']` added (react, react-hooks, jsx-a11y). */
const REACT_RULES = {
  ...reactHooks.configs.recommended.rules,
  'react/forbid-foreign-prop-types': ['warn', { allowInPropTypes: true }],
  'react/jsx-no-comment-textnodes': 'warn',
  'react/jsx-no-duplicate-props': 'warn',
  'react/jsx-no-target-blank': 'warn',
  'react/jsx-no-undef': 'error',
  'react/jsx-pascal-case': ['warn', { allowAllCaps: true, ignore: [] }],
  'react/jsx-uses-vars': 'warn',
  'react/no-danger-with-children': 'warn',
  'react/no-direct-mutation-state': 'warn',
  'react/no-is-mounted': 'warn',
  'react/no-typos': 'error',
  'react/jsx-uses-react': 'off',
  'react/react-in-jsx-scope': 'off',
  'react/require-render-return': 'error',
  'react/style-prop-object': 'warn',
  'react/jsx-no-useless-fragment': 'warn',
  'jsx-a11y/alt-text': 'warn',
  'jsx-a11y/anchor-has-content': 'warn',
  'jsx-a11y/anchor-is-valid': ['warn', { aspects: ['noHref', 'invalidHref'] }],
  'jsx-a11y/aria-activedescendant-has-tabindex': 'warn',
  'jsx-a11y/aria-props': 'warn',
  'jsx-a11y/aria-proptypes': 'warn',
  'jsx-a11y/aria-role': 'warn',
  'jsx-a11y/aria-unsupported-elements': 'warn',
  'jsx-a11y/heading-has-content': 'warn',
  'jsx-a11y/iframe-has-title': 'warn',
  'jsx-a11y/img-redundant-alt': 'warn',
  'jsx-a11y/no-access-key': 'warn',
  'jsx-a11y/no-distracting-elements': 'warn',
  'jsx-a11y/no-redundant-roles': 'warn',
  'jsx-a11y/role-has-required-aria-props': 'warn',
  'jsx-a11y/role-supports-aria-props': 'warn',
  'jsx-a11y/scope': 'warn',
};

/** The monorepo root config's language-agnostic base, minus Nx. */
const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ALL_FILES,
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    settings: { react: { version: 'detect' } },
    rules: { ...NX_ERA_TS_RULES, ...REACT_RULES },
  },
];

/** Props whose value is text the worker reads or TalkBack announces. */
const TEXT_PROPS = [
  'accessibilityLabel',
  'accessibilityHint',
  'cancelLabel',
  'confirmLabel',
  'explanation',
  'helper',
  'label',
  'line',
  'placeholder',
  'question',
  'sentence',
  'statusLine',
  'text',
  'title',
];

const TEXT_PROP_LITERAL = {
  selector: `JSXAttribute[name.name=/^(${TEXT_PROPS.join('|')})$/] > Literal[value=/[A-Za-z]/]`,
  message:
    'Text reaches a screen only through t() from src/i18n (strings.en.ts); no string literal in a text prop (R12.11).',
};

/** Hex colours (`'#fff'`, `'#1e3a5f'`, `'#1e3a5fcc'`) and `rgb(` / `rgba(` strings. */
const COLOUR_LITERALS = [
  {
    selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
    message:
      'No colour literal outside src/theme/tokens.ts: read colours through useTheme() (R12.1).',
  },
  {
    selector: 'Literal[value=/rgba?\\(/]',
    message:
      'No colour literal outside src/theme/tokens.ts: read colours through useTheme() (R12.1).',
  },
  {
    selector: 'TemplateElement[value.raw=/rgba?\\(/]',
    message:
      'No colour literal outside src/theme/tokens.ts: read colours through useTheme() (R12.1).',
  },
];

const TESTS = ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test-support/**'];

/** The `adjustsFontSizeToFit` attribute shrinks a label instead of letting it grow (R12.11). */
const ADJUSTS_FONT_SIZE_TO_FIT = {
  selector: 'JSXAttribute[name.name="adjustsFontSizeToFit"]',
  message:
    'adjustsFontSizeToFit is allowed on the punch button label only (src/components/PunchButton.tsx); every other label wraps or grows (R12.11).',
};

/** The one file that may import expo-haptics (R12.8). */
const HAPTICS_IMPORT = {
  name: 'expo-haptics',
  message:
    'expo-haptics is imported by src/theme/haptics.ts only; call punchStored(), punchRefused() or biometricFailed() from src/theme (R12.8).',
};

/** The one file that may import expo-linear-gradient (design "Home header", R12.16). */
const LINEAR_GRADIENT_IMPORT = {
  name: 'expo-linear-gradient',
  message:
    'expo-linear-gradient is imported by src/components/GradientHeader.tsx only; draw the Home band with <GradientHeader> from src/components (R12.16).',
};

const ASYNC_STORAGE_PATTERN = {
  group: ['@react-native-async-storage/*'],
  message:
    'AsyncStorage is plain-text storage. Account data goes through src/state/authStore (expo-secure-store); device data through pairingStore and the SQLite queue (R9.2).',
};

/** The web monorepo's packages: none of them loads on React Native, and none is a dependency any more. */
const WORKSPACE_PATTERNS = [
  {
    group: [
      '@inventory-platform/ui-kit',
      '@inventory-platform/ui-kit/*',
      '@inventory-platform/api-client',
      '@inventory-platform/api-client/*',
      '@inventory-platform/shell',
      '@inventory-platform/shell/*',
    ],
    message:
      'The Stockkart Team app runs on React Native: ui-kit (DOM + CSS modules), api-client (axios + localStorage) and shell (react-router) cannot load here. Use @stockkart/attendance-protocol and the app\u2019s own src/api and src/state modules.',
  },
  {
    // Since D17 the app lives in its own repository: the protocol is @stockkart/attendance-protocol
    // (packages/attendance-protocol) and ApiResponse<T> is src/api/apiResponse.ts.
    group: ['@inventory-platform/*', '@inventory-platform/*/*'],
    message:
      'No @inventory-platform/* import: the app is its own repository (README.md, Boundaries). The protocol is @stockkart/attendance-protocol; the response envelope is src/api/apiResponse.ts.',
  },
];

/** `no-restricted-imports` with every ban except the ones in `allow` (the per-file exemptions). */
function restrictedImports(allow = []) {
  return [
    'error',
    {
      paths: [HAPTICS_IMPORT, LINEAR_GRADIENT_IMPORT].filter((p) => !allow.includes(p.name)),
      patterns: [...WORKSPACE_PATTERNS, ASYNC_STORAGE_PATTERN],
    },
  ];
}

export default [
  // Native projects are generated by `expo prebuild` and never linted; build outputs neither.
  {
    ignores: [
      'android/**',
      'ios/**',
      '.expo/**',
      '**/dist/**',
      '**/out-tsc/**',
      '**/node_modules/**',
      '**/vite.config.*.timestamp*',
    ],
  },
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // expo-status-bar's `style` prop is a string ('light' | 'dark' | 'auto'), not a style object.
      'react/style-prop-object': ['warn', { allow: ['StatusBar'] }],
      'no-restricted-imports': restrictedImports(),
    },
  },
  {
    // The one file that may import expo-haptics (R12.8).
    files: ['src/theme/haptics.ts'],
    rules: {
      'no-restricted-imports': restrictedImports(['expo-haptics']),
    },
  },
  {
    // The one file that may import expo-linear-gradient (R12.16).
    files: ['src/components/GradientHeader.tsx'],
    rules: {
      'no-restricted-imports': restrictedImports(['expo-linear-gradient']),
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: TESTS,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...COLOUR_LITERALS,
        TEXT_PROP_LITERAL,
        ADJUSTS_FONT_SIZE_TO_FIT,
      ],
    },
  },
  {
    // The one label that may shrink to fit: the punch button's direction (R7.10, R12.2).
    files: ['src/components/PunchButton.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...COLOUR_LITERALS, TEXT_PROP_LITERAL],
    },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: TESTS,
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true }],
    },
  },
  {
    // The token file is where the colour literals live (R12.1).
    files: ['src/theme/tokens.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  eslintConfigPrettier,
];
