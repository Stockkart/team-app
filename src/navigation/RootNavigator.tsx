/**
 * The Stockkart Team app's one navigator (worker-app design "State machine", "Screen inventory"; R1.1,
 * R1.6, R5.5, R6.1, R6.7, R6.8, R9.3, R12.7), built around `useAppState`:
 *
 * 1. While the shell resolves (store read, `GET /hr/worker/me`) a splash is shown. Then the
 *    resolved {@link AppRoute} picks the **route group** that is mounted: `SignedOut` → Sign in,
 *    Create account, Phone and photo in `signup` mode (nothing else is reachable before one
 *    completes, R1.1); `NeedsPhone` → Phone and photo in `update` mode and nothing else (a signed-in
 *    account without a phone, R1.11, DD20); `Join`, `Waiting`, `Blocked`, `Offline` → that one
 *    screen; `Home` → Home and its modules, sub-screens and the pairing screens. React Navigation
 *    resets to the first route of a group whenever the group changes, so a worker whose request was
 *    approved moves from Waiting to Home on the next read without any screen navigating.
 * 2. Every screen re-resolves on focus (`Refocus`), the shell re-resolves on foreground, and any
 *    screen may call `shell.refresh()` or `shell.apply(state)` after an action; `shell.handleError`
 *    is where a 401 goes (R9.3); `shell.confirm` is the shell's confirm sheet (`useConfirmSheet`),
 *    mounted here above every screen, through which the account switch asks its R9.7 question
 *    (`completeSignIn` on the sign-in screens). No screen imports the navigator or `expo-*`: each
 *    gets `deps` (`AppDeps`) and `shell` (`ShellActions`) as props.
 * 3. One `BackHandler` applies `backAction(route, group)` (R6.8): leave the app from Home and
 *    everything before it (the `NeedsPhone` step included), Home from a module, the parent from a
 *    sub-screen. The mounted group is the resolved route's name, kept in a ref for the handler.
 * 4. Transitions take `useMotionDuration()` milliseconds: 200, or none when the phone's reduce-motion
 *    setting is on (R12.7).
 *
 * Screens come from `src/screens/index.ts`; every route of the screen inventory is real (tasks
 * 14.1–14.5).
 */
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  StackActions,
  useFocusEffect,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';

import type { ModuleKey } from '@stockkart/attendance-protocol';

import type { AppDeps } from '../app/deps';
import type { AppRoute } from '../app/AppStateMachine';
import { useAppState, type ShellActions } from '../app/useAppState';
import { useConfirmSheet } from '../components';
import { t } from '../i18n';
import {
  AttendanceModule,
  BlockedScreen,
  CompleteProfileScreen,
  ConsentScreen,
  CreateAccountScreen,
  EditDetailsScreen,
  HistoryModule,
  JoinShopScreen,
  OfflineScreen,
  PairScreen,
  PhoneAndPhotoScreen,
  ProfileScreen,
  SignInScreen,
  WaitingScreen,
  WorkerHomeScreen,
} from '../screens';
import type { AccountProfile } from '../state/authStore';
import { useMotionDuration, useTheme } from '../theme';
import { EXIT, backAction } from './backAction';
import { ROUTES, isRouteName, type RootStackParamList, type RouteGroup } from './routes';

const Stack = createNativeStackNavigator<RootStackParamList>();

export interface RootNavigatorProps {
  deps: AppDeps;
}

export function RootNavigator({ deps }: RootNavigatorProps) {
  const appState = useAppState({
    authStore: deps.authStore,
    pairingStore: deps.pairingStore,
    account: deps.account,
    foreground: deps.foreground,
    onError: reportError,
  });
  const { confirm, sheet } = useConfirmSheet();
  const { refresh, apply, handleError } = appState;
  const shell = useMemo<ShellActions>(
    () => ({ refresh, apply, handleError, confirm }),
    [refresh, apply, handleError, confirm],
  );
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const animationDuration = useMotionDuration();
  const { tokens, scheme } = useTheme();
  // The container paints the canvas colour between screens, so a dark theme never flashes white.
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: { ...base.colors, background: tokens.color.bgCanvas },
  };

  // The mounted group, for the back rule: `PhoneAndPhoto` is a sub-screen when signed out and a
  // pre-Home root in `NeedsPhone` (R6.8). A ref, so the one handler below sees the latest.
  const groupRef = useRef<RouteGroup | null>(null);
  groupRef.current = appState.state.status === 'ready' ? appState.state.route.name : null;

  // The one hardware-back rule (R6.8). Registered after the container's own handler (a parent's
  // effect runs after its children's), so it is asked first.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigationRef.isReady()) {
        return false;
      }
      const current = navigationRef.getCurrentRoute()?.name;
      const group = groupRef.current;
      if (!isRouteName(current) || group == null) {
        return false;
      }
      const target = backAction(current, group);
      if (target === EXIT) {
        return false;
      }
      const mounted: readonly string[] = navigationRef.getRootState()?.routeNames ?? [];
      if (mounted.includes(target)) {
        navigationRef.dispatch(StackActions.popTo(target));
        return true;
      }
      // Every target is in its route's own group; a name this version does not know leaves the
      // app rather than trapping the worker (R6.8).
      return false;
    });
    return () => subscription.remove();
  }, [navigationRef]);

  if (appState.state.status === 'resolving') {
    return (
      <View
        style={[styles.centre, { backgroundColor: tokens.color.bgCanvas }]}
        testID="shell-resolving"
      >
        <ActivityIndicator accessibilityLabel={t('common.loading')} color={tokens.color.brand} />
      </View>
    );
  }

  const { route, profile } = appState.state;

  return (
    <>
      <NavigationContainer ref={navigationRef} theme={navigationTheme}>
        {/*
          Keyed by the group so a group change always starts at the group's first route. React
          Navigation keeps the focused route when its name is still in the new set, and
          `PhoneAndPhoto` is in two groups (`SignedOut`, `NeedsPhone`): without the key, a log out
          from the phone step would leave the stack on the signup screen with no params.
        */}
        <Stack.Navigator
          key={route.name}
          screenOptions={{
            headerShown: false,
            animationDuration,
            animation: animationDuration === 0 ? 'none' : 'default',
          }}
        >
          {routeGroup(route, { deps, shell, profile })}
        </Stack.Navigator>
      </NavigationContainer>
      {sheet}
    </>
  );
}

function reportError(context: string, error: unknown): void {
  console.warn(`[attendance] ${context}`, error);
}

// --- the route groups ---

interface GroupContext {
  deps: AppDeps;
  shell: ShellActions;
  profile: AccountProfile | null;
}

/** The `Stack.Screen`s of the group `route` names; React Navigation resets when the set changes. */
function routeGroup(route: AppRoute, ctx: GroupContext): ReactNode {
  switch (route.name) {
    case 'SignedOut':
      return signedOutGroup(route, ctx);
    case 'NeedsPhone':
      return needsPhoneGroup(ctx);
    case 'Join':
      return joinGroup(route, ctx);
    case 'Waiting':
      return waitingGroup(route, ctx);
    case 'Blocked':
      return blockedGroup(route, ctx);
    case 'Offline':
      return offlineGroup(ctx);
    case 'Home':
      return homeGroup(route, ctx);
  }
}

function signedOutGroup(route: Extract<AppRoute, { name: 'SignedOut' }>, ctx: GroupContext) {
  const { deps, shell } = ctx;
  return (
    <Stack.Group key="signed-out">
      <Stack.Screen name={ROUTES.SignIn}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <SignInScreen
              deps={deps}
              shell={shell}
              sessionEnded={route.sessionEnded}
              onCreateAccount={() => navigation.navigate(ROUTES.CreateAccount)}
              onGoogleNeedsSignup={(params) => navigation.navigate(ROUTES.PhoneAndPhoto, params)}
            />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.CreateAccount}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <CreateAccountScreen
              deps={deps}
              shell={shell}
              onSignInInstead={() => navigation.popTo(ROUTES.SignIn)}
              onGoogleNeedsPhone={(params) => navigation.navigate(ROUTES.PhoneAndPhoto, params)}
            />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.PhoneAndPhoto}>
        {({ navigation, route: current }) => (
          <Refocus shell={shell}>
            <PhoneAndPhotoScreen
              deps={deps}
              shell={shell}
              params={current.params}
              // Back to whichever screen opened it: Create account or Sign in (R1.10).
              onBack={() =>
                navigation.canGoBack() ? navigation.goBack() : navigation.popTo(ROUTES.SignIn)
              }
            />
          </Refocus>
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

/**
 * A signed-in account without a phone (R1.11, DD20): the phone step in `update` mode, alone. Home,
 * Join, Waiting and Blocked are not in this group, so none is reachable until Save succeeds and
 * the next resolution names one of them. Hardware back leaves the app (`backAction`, R6.8).
 */
function needsPhoneGroup(ctx: GroupContext) {
  const { deps, shell, profile } = ctx;
  return (
    <Stack.Group key="needs-phone">
      <Stack.Screen name={ROUTES.PhoneAndPhoto}>
        {() => (
          <Refocus shell={shell}>
            <PhoneAndPhotoScreen
              deps={deps}
              shell={shell}
              params={{ mode: 'update' }}
              profile={profile}
            />
          </Refocus>
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

function joinGroup(route: Extract<AppRoute, { name: 'Join' }>, ctx: GroupContext) {
  const { deps, shell, profile } = ctx;
  return (
    <Stack.Group key="join">
      <Stack.Screen name={ROUTES.Join}>
        {() => (
          <Refocus shell={shell}>
            <JoinShopScreen deps={deps} shell={shell} state={route.state} profile={profile} />
          </Refocus>
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

function waitingGroup(route: Extract<AppRoute, { name: 'Waiting' }>, ctx: GroupContext) {
  const { deps, shell } = ctx;
  return (
    <Stack.Group key="waiting">
      <Stack.Screen name={ROUTES.Waiting}>
        {() => (
          <Refocus shell={shell}>
            <WaitingScreen deps={deps} shell={shell} state={route.state} />
          </Refocus>
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

function blockedGroup(route: Extract<AppRoute, { name: 'Blocked' }>, ctx: GroupContext) {
  const { deps, shell } = ctx;
  return (
    <Stack.Group key="blocked">
      <Stack.Screen name={ROUTES.Blocked}>
        {() => (
          <Refocus shell={shell}>
            <BlockedScreen deps={deps} shell={shell} kind={route.kind} />
          </Refocus>
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

function offlineGroup(ctx: GroupContext) {
  const { deps, shell } = ctx;
  return (
    <Stack.Group key="offline">
      <Stack.Screen name={ROUTES.Offline}>
        {() => (
          <Refocus shell={shell}>
            <OfflineScreen deps={deps} shell={shell} />
          </Refocus>
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

function homeGroup(route: Extract<AppRoute, { name: 'Home' }>, ctx: GroupContext) {
  const { deps, shell, profile } = ctx;
  const state = route.state;
  return (
    <Stack.Group key="home">
      <Stack.Screen name={ROUTES.Home}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <WorkerHomeScreen
              deps={deps}
              shell={shell}
              state={state}
              profile={profile}
              offline={route.offline}
              onOpenModule={(key) => navigation.navigate(MODULE_ROUTE[key])}
            />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.Attendance}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <AttendanceModule
              deps={deps}
              shell={shell}
              state={state}
              onHaveCode={() => navigation.navigate(ROUTES.Pair)}
              onBack={() => navigation.popTo(ROUTES.Home)}
            />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.Pair}>
        {({ navigation }) => (
          <PairScreen
            flow={deps.workerPairingFlow}
            // R7.2: "Yes, this is me" shows the account's own name and shop, not the code's.
            identity={{
              shopName: state.shop?.shopName ?? '',
              employeeName: profile?.name ?? state.employee?.name ?? '',
            }}
            onIdentityConfirmed={(params) => navigation.navigate(ROUTES.Consent, params)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.Consent}>
        {({ navigation, route: current }) => (
          <ConsentScreen
            params={current.params}
            flow={deps.workerPairingFlow}
            onPaired={() => {
              // The pairing and its owner (`ownedPairingStore`) are stored; the next state read
              // says PAIRED (R7.1).
              void shell.refresh();
              navigation.popTo(ROUTES.Attendance);
            }}
            onDeclined={() => navigation.popTo(ROUTES.Pair)}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.History}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <HistoryModule deps={deps} shell={shell} onBack={() => navigation.popTo(ROUTES.Home)} />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.Profile}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <ProfileScreen
              deps={deps}
              shell={shell}
              state={state}
              profile={profile}
              onEditDetails={() => navigation.navigate(ROUTES.EditDetails)}
              onCompleteProfile={() => navigation.navigate(ROUTES.CompleteProfile)}
            />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.EditDetails}>
        {({ navigation }) => (
          <Refocus shell={shell}>
            <EditDetailsScreen
              deps={deps}
              shell={shell}
              profile={profile}
              onDone={() => navigation.popTo(ROUTES.Profile)}
            />
          </Refocus>
        )}
      </Stack.Screen>
      <Stack.Screen name={ROUTES.CompleteProfile}>
        {({ navigation }) => (
          <CompleteProfileScreen onBack={() => navigation.popTo(ROUTES.Profile)} />
        )}
      </Stack.Screen>
    </Stack.Group>
  );
}

/** The route each known module key opens (R6.4). */
const MODULE_ROUTE: Record<ModuleKey, 'Attendance' | 'History' | 'Profile'> = {
  ATTENDANCE: ROUTES.Attendance,
  HISTORY: ROUTES.History,
  PROFILE: ROUTES.Profile,
};

/**
 * Re-resolves the shell each time the screen inside regains focus (design "State machine": "every
 * screen focus re-runs the state call"). The first focus, right after the screen mounts, is skipped:
 * the resolution that mounted the group is that read.
 */
function Refocus({ shell, children }: { shell: ShellActions; children: ReactNode }) {
  const first = useRef(true);
  const refresh = shell.refresh;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void refresh();
    }, [refresh]),
  );
  return children;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
