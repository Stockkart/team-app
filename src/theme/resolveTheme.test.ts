// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from './ThemeProvider';
import { dark, light } from './tokens';
import {
  isThemeOverride,
  resolveTheme,
  staticTheme,
  THEME_OVERRIDES,
  useTheme,
  type SystemScheme,
  type Theme,
  type ThemeOverride,
} from './useTheme';

/** The phone's light / dark setting behind the `react-native` test alias. */
const phone = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' | null | undefined }));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, useColorScheme: () => phone.scheme };
});

afterEach(() => {
  cleanup();
  phone.scheme = 'light';
});

describe('resolveTheme', () => {
  it.each([
    ['light', 'system', 'light'],
    ['dark', 'system', 'dark'],
    [null, 'system', 'light'],
    [undefined, 'system', 'light'],
    ['unspecified', 'system', 'light'],
    ['light', undefined, 'light'],
    ['dark', null, 'dark'],
  ] as const)('follows the phone when the override is %j / %j → %s', (system, override, want) => {
    expect(resolveTheme(system, override)).toBe(want);
  });

  it.each([
    ['light', 'dark', 'dark'],
    ['dark', 'light', 'light'],
    [null, 'dark', 'dark'],
    [undefined, 'light', 'light'],
  ] as const)('an explicit override wins over the phone %j / %j → %s', (system, override, want) => {
    expect(resolveTheme(system, override)).toBe(want);
  });

  it('over the whole table: the override unless it is system, then the phone, then light', () => {
    const systems: readonly SystemScheme[] = ['light', 'dark', 'unspecified', null, undefined];
    const overrides: readonly (ThemeOverride | null | undefined)[] = [
      'system',
      'light',
      'dark',
      null,
      undefined,
    ];
    for (const system of systems) {
      for (const override of overrides) {
        const want =
          override === 'light' || override === 'dark'
            ? override
            : system === 'dark'
            ? 'dark'
            : 'light';
        expect(resolveTheme(system, override), `${String(system)} / ${String(override)}`).toBe(
          want,
        );
      }
    }
  });
});

describe('theme overrides', () => {
  it('lists exactly system, light and dark', () => {
    expect(THEME_OVERRIDES).toEqual(['system', 'light', 'dark']);
  });

  it.each(['system', 'light', 'dark'])('accepts %s', (value) => {
    expect(isThemeOverride(value)).toBe(true);
  });

  it.each(['auto', '', 'Dark', 1, null, undefined, {}])('rejects %j', (value) => {
    expect(isThemeOverride(value)).toBe(false);
  });
});

describe('staticTheme', () => {
  it('pairs each scheme with its tokens and a no-op setter', () => {
    expect(staticTheme('light').tokens).toBe(light);
    expect(staticTheme('dark').tokens).toBe(dark);
    expect(staticTheme('dark', 'dark').override).toBe('dark');
    expect(staticTheme('light').override).toBe('system');
    expect(() => staticTheme('light').setOverride('dark')).not.toThrow();
  });
});

describe('useTheme', () => {
  it('outside a ThemeProvider answers the light theme with a no-op setter', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.tokens).toBe(light);
    expect(result.current.override).toBe('system');
    act(() => result.current.setOverride('dark'));
    expect(result.current.scheme).toBe('light');
  });
});

describe('ThemeProvider (R12.10)', () => {
  function mount(props: {
    override?: ThemeOverride;
    onOverrideChange?: (o: ThemeOverride) => void;
  }) {
    return renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(ThemeProvider, { ...props, children }),
    });
  }

  it('follows the phone when the override is system, and re-resolves when the phone changes', () => {
    phone.scheme = 'dark';
    const { result, rerender } = mount({ override: 'system' });
    expect(result.current.scheme).toBe('dark');
    expect(result.current.tokens).toBe(dark);
    phone.scheme = 'light';
    rerender();
    expect(result.current.scheme).toBe('light');
    expect(result.current.tokens).toBe(light);
  });

  it('draws the persisted override over the phone setting', () => {
    phone.scheme = 'dark';
    const { result } = mount({ override: 'light' });
    expect(result.current.scheme).toBe('light');
    expect(result.current.override).toBe('light');
  });

  it('switches at once on setOverride and reports the choice for the owner to persist', () => {
    const onOverrideChange = vi.fn();
    const { result } = mount({ override: 'system', onOverrideChange });
    act(() => result.current.setOverride('dark'));
    expect(onOverrideChange).toHaveBeenCalledWith('dark');
    expect(result.current.scheme).toBe('dark');
    expect(result.current.override).toBe('dark');
  });

  it('takes the owner\u2019s value when it changes, e.g. after the store loads on start-up', () => {
    const seen: { theme: Theme | null } = { theme: null };
    function Probe() {
      seen.theme = useTheme();
      return null;
    }
    const tree = (override?: ThemeOverride) =>
      createElement(ThemeProvider, { override, children: createElement(Probe) });
    const { rerender } = render(tree(undefined));
    expect(seen.theme?.override).toBe('system');
    rerender(tree('dark'));
    expect(seen.theme?.override).toBe('dark');
    expect(seen.theme?.scheme).toBe('dark');
  });
});
