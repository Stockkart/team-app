import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as haptics from './haptics';

const { impactAsync, notificationAsync } = vi.hoisted(() => ({
  impactAsync: vi.fn<(style: string) => Promise<void>>(),
  notificationAsync: vi.fn<(kind: string) => Promise<void>>(),
}));

vi.mock('expo-haptics', () => ({
  impactAsync,
  notificationAsync,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

describe('haptics (R12.8)', () => {
  beforeEach(() => {
    impactAsync.mockReset().mockResolvedValue(undefined);
    notificationAsync.mockReset().mockResolvedValue(undefined);
  });

  it('a stored punch is one medium impact and nothing else', async () => {
    await haptics.punchStored();
    expect(impactAsync).toHaveBeenCalledTimes(1);
    expect(impactAsync).toHaveBeenCalledWith('medium');
    expect(notificationAsync).not.toHaveBeenCalled();
  });

  it('a refused punch is the error pattern once', async () => {
    await haptics.punchRefused();
    expect(notificationAsync).toHaveBeenCalledTimes(1);
    expect(notificationAsync).toHaveBeenCalledWith('error');
    expect(impactAsync).not.toHaveBeenCalled();
  });

  it('a failed biometric is the error pattern once', async () => {
    await haptics.biometricFailed();
    expect(notificationAsync).toHaveBeenCalledTimes(1);
    expect(notificationAsync).toHaveBeenCalledWith('error');
    expect(impactAsync).not.toHaveBeenCalled();
  });

  it('exports exactly the three cues', () => {
    expect(Object.keys(haptics).sort()).toEqual(['biometricFailed', 'punchRefused', 'punchStored']);
  });

  it('a phone without a haptic engine is not an error', async () => {
    impactAsync.mockRejectedValue(new Error('no haptics'));
    notificationAsync.mockRejectedValue(new Error('no haptics'));
    await expect(haptics.punchStored()).resolves.toBeUndefined();
    await expect(haptics.punchRefused()).resolves.toBeUndefined();
  });
});
