/**
 * `react-native` as plain DOM elements, for screen and component tests under vitest + jsdom.
 * `vite.config.mts` aliases `react-native` to this file in the test run only; Metro never sees it.
 *
 * The real `react-native` package cannot load in node (Flow syntax, native modules), and a React
 * Native renderer would need Jest's preset. This stub keeps the test surface small on purpose: a
 * screen's structure, texts and taps are what the tests assert, not layout. `View` → `div`,
 * `Text` → `span`, `Pressable` → `button`, `ScrollView` → `div`, `TextInput` → `input`,
 * `Image` → `img`, `Modal` → its children when visible; accessibility props are mapped so
 * `getByRole` / `getByLabelText` work. `TextInput` forwards `onFocus` / `onBlur` so a floating
 * label can be driven with `fireEvent.focus`.
 *
 * Styles are not applied, but the flattened style object is kept on the element as `data-style`
 * (JSON) and `hitSlop` as `data-hitslop`, so a component test can assert a minimum height or a
 * touch-area extension without a layout engine (`styleOf`, `hitSlopOf` below).
 */
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

type AnyProps = PropsWithChildren<Record<string, unknown>>;

type StyleValue = Record<string, unknown> | false | null | undefined | 0 | '';
type StyleProp = StyleValue | readonly StyleProp[];

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) {
    return {};
  }
  if (Array.isArray(style)) {
    return (style as StyleProp[]).reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, ...flattenStyle(item) }),
      {},
    );
  }
  return typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

function domProps(props: AnyProps, pressed = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof props.testID === 'string') {
    out['data-testid'] = props.testID;
  }
  if (typeof props.accessibilityLabel === 'string') {
    out['aria-label'] = props.accessibilityLabel;
  }
  if (typeof props.accessibilityHint === 'string') {
    out['data-hint'] = props.accessibilityHint;
  }
  if (typeof props.accessibilityRole === 'string') {
    out['role'] = props.accessibilityRole === 'header' ? 'heading' : props.accessibilityRole;
  }
  if (typeof props.accessibilityLiveRegion === 'string') {
    out['aria-live'] = props.accessibilityLiveRegion;
  }
  const state = props.accessibilityState as Record<string, unknown> | undefined;
  if (state && typeof state === 'object') {
    if (typeof state.disabled === 'boolean') {
      out['aria-disabled'] = state.disabled;
    }
    if (typeof state.busy === 'boolean') {
      out['aria-busy'] = state.busy;
    }
    if (typeof state.selected === 'boolean') {
      out['aria-selected'] = state.selected;
    }
  }
  if (typeof props.allowFontScaling === 'boolean') {
    out['data-font-scaling'] = JSON.stringify({
      allowFontScaling: props.allowFontScaling,
      maxFontSizeMultiplier: props.maxFontSizeMultiplier,
    });
  }
  if (typeof props.numberOfLines === 'number') {
    // A label that truncates would hide a longer translation (R12.11); `i18n/pseudo.test.tsx`
    // asserts no screen sets this.
    out['data-number-of-lines'] = String(props.numberOfLines);
  }
  if (props.adjustsFontSizeToFit === true) {
    // The one label allowed to shrink instead of grow: the punch button's (R7.10, R12.2).
    out['data-adjusts-font-size-to-fit'] = 'true';
  }
  const style = typeof props.style === 'function' ? props.style({ pressed }) : props.style;
  const flat = flattenStyle(style);
  if (Object.keys(flat).length > 0) {
    out['data-style'] = JSON.stringify(flat);
  }
  if (props.hitSlop !== undefined && props.hitSlop !== null) {
    out['data-hitslop'] = JSON.stringify(props.hitSlop);
  }
  // Other shims (`expo-linear-gradient.tsx`) hand their own `data-*` attributes through `View`.
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('data-') && typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

/** The flattened `style` a component gave an element (`{}` when none). */
export function styleOf(element: Element): Record<string, unknown> {
  const raw = element.getAttribute('data-style');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/** The `hitSlop` a component gave an element (`null` when none). */
export function hitSlopOf(element: Element): unknown {
  const raw = element.getAttribute('data-hitslop');
  return raw ? (JSON.parse(raw) as unknown) : null;
}

/** The font-scaling props a `Text` / `TextInput` carried (`null` when it had none). */
export function fontScalingOf(element: Element): unknown {
  const raw = element.getAttribute('data-font-scaling');
  return raw ? (JSON.parse(raw) as unknown) : null;
}

/** The `numberOfLines` a `Text` carried (`null` when it had none, which is the rule). */
export function numberOfLinesOf(element: Element): number | null {
  const raw = element.getAttribute('data-number-of-lines');
  return raw === null ? null : Number(raw);
}

/** Whether a `Text` carried `adjustsFontSizeToFit` (the punch button's label only). */
export function adjustsFontSizeToFitOf(element: Element): boolean {
  return element.getAttribute('data-adjusts-font-size-to-fit') === 'true';
}

export function View(props: AnyProps) {
  return <div {...domProps(props)}>{props.children as ReactNode}</div>;
}

/** `contentContainerStyle` is kept as `data-content-style` (JSON), read back with `contentStyleOf`. */
export function ScrollView(props: AnyProps) {
  const content = flattenStyle(props.contentContainerStyle);
  return (
    <div
      {...domProps(props)}
      data-content-style={Object.keys(content).length > 0 ? JSON.stringify(content) : undefined}
    >
      {props.children as ReactNode}
    </div>
  );
}

/** The flattened `contentContainerStyle` a `ScrollView` was given (`{}` when none). */
export function contentStyleOf(element: Element): Record<string, unknown> {
  const raw = element.getAttribute('data-content-style');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export function Text(props: AnyProps) {
  return <span {...domProps(props)}>{props.children as ReactNode}</span>;
}

export function ActivityIndicator(props: AnyProps) {
  return <progress {...domProps(props)} />;
}

export function Image(props: AnyProps) {
  const source = props.source as { uri?: string; headers?: Record<string, string> } | undefined;
  return (
    <img
      {...domProps(props)}
      src={source?.uri}
      data-headers={source?.headers ? JSON.stringify(source.headers) : undefined}
      alt={typeof props.accessibilityLabel === 'string' ? props.accessibilityLabel : ''}
    />
  );
}

/** Renders its children only while `visible`; `onRequestClose` is reachable through `data-testid`. */
export function Modal(props: AnyProps) {
  const { visible } = props as { visible?: boolean };
  if (visible === false) {
    return null;
  }
  return (
    <div {...domProps(props)} data-modal="true">
      {props.children as ReactNode}
    </div>
  );
}

export function Pressable(props: AnyProps) {
  const { onPress, disabled } = props as { onPress?: () => void; disabled?: boolean };
  const dom = domProps(props);
  // A DOM <button> already has role=button; a `link` role on a button confuses nothing in tests.
  return (
    <button type="button" {...dom} disabled={disabled === true} onClick={() => onPress?.()}>
      {props.children as ReactNode}
    </button>
  );
}

export function TextInput(props: AnyProps) {
  const {
    value,
    placeholder,
    maxLength,
    editable,
    secureTextEntry,
    onChangeText,
    onSubmitEditing,
    onFocus,
    onBlur,
  } = props as {
    value?: string;
    placeholder?: string;
    maxLength?: number;
    editable?: boolean;
    secureTextEntry?: boolean;
    onChangeText?: (text: string) => void;
    onSubmitEditing?: () => void;
    onFocus?: (event: unknown) => void;
    onBlur?: (event: unknown) => void;
  };
  return (
    <input
      type={secureTextEntry ? 'password' : 'text'}
      {...domProps(props)}
      value={value ?? ''}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={editable === false}
      onFocus={(event) => onFocus?.(event)}
      onBlur={(event) => onBlur?.(event)}
      onChange={(event) => onChangeText?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onSubmitEditing?.();
        }
      }}
    />
  );
}

export const StyleSheet = {
  create<T extends Record<string, CSSProperties | Record<string, unknown>>>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): Record<string, unknown> {
    return flattenStyle(style);
  },
  hairlineWidth: 1,
  absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
};

export const Platform = {
  OS: 'android' as const,
  Version: 28,
  select<T>(spec: { android?: T; ios?: T; default?: T }): T | undefined {
    return spec.android ?? spec.default;
  },
};

// --- Theme, motion and accessibility APIs used by `src/theme` (task 12.1). Tests that need another
// answer mock `react-native` in the test file (`vi.mock`) on top of this alias.

export type ColorSchemeName = 'light' | 'dark' | null | undefined;

export const Appearance = {
  getColorScheme(): ColorSchemeName {
    return 'light';
  },
  addChangeListener() {
    return { remove: () => undefined };
  },
};

export function useColorScheme(): ColorSchemeName {
  return Appearance.getColorScheme();
}

/** A 360 × 800 dp phone window; a test that needs another size mocks `react-native` on top. */
export function useWindowDimensions(): {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
} {
  return { width: 360, height: 800, scale: 2, fontScale: 1 };
}

type EasingFunction = (t: number) => number;

/** The subset of `Easing` the theme uses, with React Native's real formulas. */
export const Easing = {
  linear: ((t: number) => t) as EasingFunction,
  cubic: ((t: number) => t * t * t) as EasingFunction,
  out:
    (easing: EasingFunction): EasingFunction =>
    (t: number) =>
      1 - easing(1 - t),
};

export const AccessibilityInfo = {
  isReduceMotionEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  },
  addEventListener(_event: string, _handler: (value: boolean) => void) {
    return { remove: () => undefined };
  },
  announceForAccessibility: (_text: string): void => undefined,
};

// --- `Animated`, as far as the component kit uses it (task 12.2): a value, `timing` that jumps to
// the target when started, and `Animated.View`. No frames are played in tests.

class AnimatedValue {
  private value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  setValue(value: number): void {
    this.value = value;
  }

  /** The current number, for tests that want to know where an animation ended. */
  __getValue(): number {
    return this.value;
  }

  interpolate(): AnimatedValue {
    return this;
  }
}

export const Animated = {
  Value: AnimatedValue,
  View,
  timing(value: AnimatedValue, config: { toValue: number }) {
    return {
      start(callback?: (result: { finished: boolean }) => void): void {
        value.setValue(config.toValue);
        callback?.({ finished: true });
      },
      stop(): void {
        // nothing to stop: the jump already happened
      },
    };
  },
};

// --- `AppState` and `BackHandler`, as far as the shell uses them (task 13.4). Tests drive them
// through `emitAppState` and `pressHardwareBack`; nothing fires on its own.

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

type AppStateListener = (status: AppStateStatus) => void;
const appStateListeners = new Set<AppStateListener>();

export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener(_event: 'change', listener: AppStateListener) {
    appStateListeners.add(listener);
    return {
      remove: () => {
        appStateListeners.delete(listener);
      },
    };
  },
};

/** Tells every `AppState` listener the app is now `status` (and records it as current). */
export function emitAppState(status: AppStateStatus): void {
  AppState.currentState = status;
  for (const listener of [...appStateListeners]) {
    listener(status);
  }
}

type BackListener = () => boolean | null | undefined;
const backListeners: BackListener[] = [];

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', listener: BackListener) {
    backListeners.push(listener);
    return {
      remove: () => {
        const at = backListeners.indexOf(listener);
        if (at >= 0) {
          backListeners.splice(at, 1);
        }
      },
    };
  },
  exitApp(): void {
    // Recorded by `pressHardwareBack` as "nothing handled it".
  },
};

/**
 * Presses the hardware back button the way React Native does: listeners in reverse order of
 * registration, stopping at the first that returns true. Returns whether one handled it (false
 * means the OS would leave the app).
 */
export function pressHardwareBack(): boolean {
  for (const listener of [...backListeners].reverse()) {
    if (listener() === true) {
      return true;
    }
  }
  return false;
}
