/**
 * `@react-navigation/native` and `@react-navigation/native-stack` as a small in-memory stack, for
 * the navigator tests under vitest + jsdom (`src/navigation/*.test.tsx`). The real packages need
 * `react-native-screens` and the native `BackHandler`/`Linking`, which the DOM stub of
 * `react-native` does not provide; a test replaces both modules with this file:
 *
 *   vi.mock('@react-navigation/native', () => import('../../test-support/fake-navigation'));
 *   vi.mock('@react-navigation/native-stack', () => import('../../test-support/fake-navigation'));
 *
 * What is modelled, because `RootNavigator` depends on it:
 *
 * - `createNativeStackNavigator()` → `Navigator`, `Screen`, `Group`. The navigator collects its
 *   `Screen`s (through `Group`s, fragments, arrays and `null`s), starts on the first one, and
 *   **resets to the first one whenever the set of screen names changes** (React Navigation's
 *   behaviour when conditional screens change: the auth-flow pattern).
 * - Every route in the stack stays mounted; the top one is focused, the others are `hidden`.
 *   `useFocusEffect(effect)` runs `effect` when its route becomes focused and its cleanup when the
 *   route loses focus, like the real hook.
 * - `navigation.navigate(name, params)`, `popTo(name, params)`, `goBack()`, `canGoBack()`,
 *   `reset(state)`; `StackActions.popTo(name)` through `dispatch`.
 * - `useNavigationContainerRef()` → an object the container attaches to with `isReady()`,
 *   `getCurrentRoute()`, `getRootState()`, `dispatch()`, `canGoBack()`, `goBack()`.
 * - `NavigationIndependentTree` renders its children; `DefaultTheme` / `DarkTheme` carry `colors`.
 *
 * Not modelled: params typing, headers, animations, listeners, linking.
 */
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

// --- types ---

export interface FakeRoute {
  key: string;
  name: string;
  params?: unknown;
}

export interface FakeNavigation {
  navigate(name: string, params?: unknown): void;
  popTo(name: string, params?: unknown): void;
  goBack(): void;
  canGoBack(): boolean;
  reset(state: { index: number; routes: { name: string; params?: unknown }[] }): void;
  dispatch(action: FakeAction): void;
}

export type FakeAction =
  | { type: 'POP_TO'; payload: { name: string; params?: unknown } }
  | { type: 'GO_BACK' };

export interface FakeRootState {
  routeNames: string[];
  routes: FakeRoute[];
  index: number;
}

export interface FakeContainerApi {
  isReady(): boolean;
  getCurrentRoute(): FakeRoute | undefined;
  getRootState(): FakeRootState;
  dispatch(action: FakeAction): void;
  canGoBack(): boolean;
  goBack(): void;
  navigate(name: string, params?: unknown): void;
}

type ScreenRender =
  | ReactNode
  | ((props: { navigation: FakeNavigation; route: FakeRoute }) => ReactNode);

interface ScreenDef {
  name: string;
  render: ScreenRender;
  initialParams?: unknown;
}

// --- contexts ---

/** The container hands the navigator a way to publish its api to the container ref. */
const AttachContext = createContext<((api: FakeContainerApi | null) => void) | null>(null);

const FocusContext = createContext<boolean>(true);

const NavigationContext = createContext<FakeNavigation | null>(null);

// --- public api of `@react-navigation/native` ---

export const StackActions = {
  popTo(name: string, params?: unknown): FakeAction {
    return { type: 'POP_TO', payload: { name, params } };
  },
};

export const DefaultTheme = {
  dark: false,
  colors: {
    primary: '#000',
    background: '#fff',
    card: '#fff',
    text: '#000',
    border: '#ccc',
    notification: '#f00',
  },
};

export const DarkTheme = {
  dark: true,
  colors: {
    primary: '#fff',
    background: '#000',
    card: '#000',
    text: '#fff',
    border: '#333',
    notification: '#f00',
  },
};

export function NavigationIndependentTree({ children }: { children: ReactNode }) {
  return children;
}

export function useFocusEffect(effect: () => void | (() => void)): void {
  const focused = useContext(FocusContext);
  useEffect(() => {
    if (!focused) {
      return undefined;
    }
    return effect();
  }, [focused, effect]);
}

export function useNavigation(): FakeNavigation {
  const navigation = useContext(NavigationContext);
  if (!navigation) {
    throw new Error('useNavigation outside a navigator');
  }
  return navigation;
}

export function useIsFocused(): boolean {
  return useContext(FocusContext);
}

/** The ref `NavigationContainer` attaches to; its methods forward to the attached api. */
export interface FakeContainerRef extends FakeContainerApi {
  current: FakeContainerApi | null;
}

export function createNavigationContainerRef(): FakeContainerRef {
  const ref: FakeContainerRef = {
    current: null,
    isReady: () => ref.current != null,
    getCurrentRoute: () => ref.current?.getCurrentRoute(),
    getRootState: () => {
      if (!ref.current) {
        throw new Error('navigation container not ready');
      }
      return ref.current.getRootState();
    },
    dispatch: (action) => ref.current?.dispatch(action),
    canGoBack: () => ref.current?.canGoBack() ?? false,
    goBack: () => ref.current?.goBack(),
    navigate: (name, params) => ref.current?.navigate(name, params),
  };
  return ref;
}

export function useNavigationContainerRef(): FakeContainerRef {
  const ref = useRef<FakeContainerRef | null>(null);
  if (ref.current == null) {
    ref.current = createNavigationContainerRef();
  }
  return ref.current;
}

export function NavigationContainer({
  children,
  ref,
}: {
  children: ReactNode;
  ref?: FakeContainerRef | { current: FakeContainerApi | null };
  theme?: unknown;
}) {
  const attach = useCallback(
    (api: FakeContainerApi | null) => {
      if (ref) {
        ref.current = api;
      }
    },
    [ref],
  );
  return <AttachContext.Provider value={attach}>{children}</AttachContext.Provider>;
}

// --- `@react-navigation/native-stack` ---

export interface FakeScreenProps {
  name: string;
  children?: ScreenRender;
  component?: (props: { navigation: FakeNavigation; route: FakeRoute }) => ReactNode;
  initialParams?: unknown;
  options?: unknown;
}

export interface FakeGroupProps {
  children?: ReactNode;
  screenOptions?: unknown;
}

export interface FakeNavigatorProps {
  children: ReactNode;
  initialRouteName?: string;
  screenOptions?: unknown;
}

export interface FakeStack {
  Navigator: (props: FakeNavigatorProps) => ReactNode;
  Screen: (props: FakeScreenProps) => null;
  Group: (props: FakeGroupProps) => ReactNode;
}

export function createNativeStackNavigator(): FakeStack {
  return { Navigator: FakeStackNavigator, Screen: FakeScreen, Group: FakeGroup };
}

/** `Stack.Screen`: renders nothing itself; the navigator reads its props. */
export function FakeScreen(_props: FakeScreenProps): null {
  return null;
}

export function FakeGroup({ children }: FakeGroupProps): ReactNode {
  return children ?? null;
}

/** Flattens `Screen` elements out of groups, fragments, arrays and `null`s, in order. */
function collectScreens(children: ReactNode, out: ScreenDef[] = []): ScreenDef[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }
    const element = child as ReactElement<Record<string, unknown>>;
    if (element.type === FakeScreen) {
      const props = element.props as unknown as FakeScreenProps;
      out.push({
        name: props.name,
        render: props.children ?? props.component ?? null,
        initialParams: props.initialParams,
      });
      return;
    }
    if (element.type === FakeGroup || element.type === Fragment) {
      collectScreens((element.props as { children?: ReactNode }).children, out);
    }
  });
  return out;
}

let keyCounter = 0;
function routeKey(name: string): string {
  keyCounter += 1;
  return `${name}-${keyCounter}`;
}

export function FakeStackNavigator({ children, initialRouteName }: FakeNavigatorProps): ReactNode {
  const screens = collectScreens(children);
  const namesKey = screens.map((screen) => screen.name).join('|');
  const first = screens.find((screen) => screen.name === initialRouteName) ?? screens[0];

  const [routes, setRoutes] = useState<FakeRoute[]>(() =>
    first ? [{ key: routeKey(first.name), name: first.name, params: first.initialParams }] : [],
  );
  const lastKey = useRef(namesKey);
  useEffect(() => {
    if (lastKey.current !== namesKey) {
      lastKey.current = namesKey;
      setRoutes(
        first ? [{ key: routeKey(first.name), name: first.name, params: first.initialParams }] : [],
      );
    }
  }, [namesKey, first]);

  // Reads the latest routes from inside callbacks without re-creating the api on every change.
  const routesRef = useRef(routes);
  routesRef.current = routes;

  const navigation = useMemo<FakeNavigation>(() => {
    const popTo = (name: string, params?: unknown) => {
      setRoutes((current) => {
        const at = current.findIndex((route) => route.name === name);
        if (at >= 0) {
          const kept = current.slice(0, at + 1);
          kept[at] = { ...kept[at], params: params ?? kept[at].params };
          return kept;
        }
        return [...current, { key: routeKey(name), name, params }];
      });
    };
    const goBack = () => {
      setRoutes((current) => (current.length > 1 ? current.slice(0, -1) : current));
    };
    return {
      navigate: popTo,
      popTo,
      goBack,
      canGoBack: () => routesRef.current.length > 1,
      reset: (state) =>
        setRoutes(
          state.routes.map((route) => ({
            key: routeKey(route.name),
            name: route.name,
            params: route.params,
          })),
        ),
      dispatch: (action) => {
        if (action.type === 'POP_TO') {
          popTo(action.payload.name, action.payload.params);
        } else if (action.type === 'GO_BACK') {
          goBack();
        }
      },
    };
  }, []);

  // Publish the container api.
  const attach = useContext(AttachContext);
  const screensRef = useRef(screens);
  screensRef.current = screens;
  useEffect(() => {
    if (!attach) {
      return undefined;
    }
    attach({
      isReady: () => true,
      getCurrentRoute: () => routesRef.current[routesRef.current.length - 1],
      getRootState: () => ({
        routeNames: screensRef.current.map((screen) => screen.name),
        routes: routesRef.current,
        index: routesRef.current.length - 1,
      }),
      dispatch: navigation.dispatch,
      canGoBack: navigation.canGoBack,
      goBack: navigation.goBack,
      navigate: navigation.navigate,
    });
    return () => attach(null);
  }, [attach, navigation]);

  const byName = new Map(screens.map((screen) => [screen.name, screen]));
  return (
    <NavigationContext.Provider value={navigation}>
      {routes.map((route, index) => {
        const screen = byName.get(route.name);
        if (!screen) {
          return null;
        }
        const focused = index === routes.length - 1;
        const content =
          typeof screen.render === 'function'
            ? screen.render({ navigation, route })
            : screen.render;
        return (
          <FocusContext.Provider key={route.key} value={focused}>
            <div
              data-route={route.name}
              data-focused={focused ? 'true' : 'false'}
              hidden={!focused}
            >
              {content}
            </div>
          </FocusContext.Provider>
        );
      })}
    </NavigationContext.Provider>
  );
}

// --- test helpers ---

/** The name of the focused route, or null when no navigator is mounted. */
export function focusedRouteName(root: ParentNode = document): string | null {
  const element = root.querySelector('[data-focused="true"]');
  return element?.getAttribute('data-route') ?? null;
}

/** The names of every mounted route, bottom to top. */
export function mountedRouteNames(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll('[data-route]')).map(
    (element) => element.getAttribute('data-route') ?? '',
  );
}
