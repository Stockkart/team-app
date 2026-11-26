/**
 * `expo-linear-gradient` as a plain DOM element, for component and screen tests under vitest +
 * jsdom. `vite.config.mts` aliases the package to this file in the test run only; Metro never sees
 * it. The real module is native and cannot load in node. The gradient's `colors`, `start` and
 * `end` are kept on the element as `data-gradient` (JSON) so a test can read which tokens the band
 * resolves to (`gradientOf`), and the flattened style as `data-style` like the other shims.
 */
import type { PropsWithChildren, ReactNode } from 'react';

import { View } from './react-native-dom';

export interface LinearGradientShimProps {
  colors: readonly string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: unknown;
  testID?: string;
}

/** What a `LinearGradient` was asked to draw. */
export interface GradientSpec {
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}

export function LinearGradient(props: PropsWithChildren<LinearGradientShimProps>) {
  const spec: GradientSpec = { colors: [...props.colors], start: props.start, end: props.end };
  return (
    <View
      style={props.style}
      testID={props.testID}
      // Picked up by `View` → `div` as an ordinary attribute.
      data-gradient={JSON.stringify(spec)}
    >
      {props.children as ReactNode}
    </View>
  );
}

/** The gradient an element was drawn with (`null` when it is not a gradient). */
export function gradientOf(element: Element): GradientSpec | null {
  const raw = element.getAttribute('data-gradient');
  return raw ? (JSON.parse(raw) as GradientSpec) : null;
}
