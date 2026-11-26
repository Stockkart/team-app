/**
 * The three haptic cues the app uses, and the only place `expo-haptics` is imported (R12.8; the
 * lint rule in task 12.3 enforces the import boundary). A stored punch gives one medium impact; a
 * refused punch or a failed biometric gives the phone's error pattern once. Nothing else vibrates.
 *
 * The phone's system haptic setting is honoured by the OS; the app does not check it. A device
 * without a haptic engine rejects the call, which is swallowed: a missing buzz is not an error the
 * worker should see.
 */
import * as Haptics from 'expo-haptics';

function fire(call: () => Promise<void>): Promise<void> {
  return call().catch(() => undefined);
}

/** A punch was stored (online or offline). */
export function punchStored(): Promise<void> {
  return fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** The server or the queue refused the punch. */
export function punchRefused(): Promise<void> {
  return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** The fingerprint or face check failed. */
export function biometricFailed(): Promise<void> {
  return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
