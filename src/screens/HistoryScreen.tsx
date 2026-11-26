/**
 * `HistoryScreen`: the worker's own punches of the last 31 calendar days including today
 * (Asia/Kolkata), newest first (R4.10), drawn on the Stockkart Team app's kit (design "Screen inventory":
 * History; R12.6, R12.15). The rows are grouped by day (`groupByDay`), each day one 20 dp card
 * headed by its date; a row is the direction as an icon — `arrowIn` in `success` for a check-in,
 * `arrowOut` in `danger` for a check-out (3:1 on the card) — the time in `textPrimary`, the
 * direction words, and every flag as a plain sentence (`flagSentence`) in `warning`. A duplicate
 * (not counted) row is dimmed and says so. With no punch in the window the screen shows the one
 * `EmptyState` sentence "No check-ins in the last 31 days". Refused punches never appear (the
 * server stores none), and another employee's punches are never requested (R8.9).
 *
 * The list is read from the server every time the screen is opened or returned to (R4.10) through
 * {@link loadHistory}, which also replaces the SQLite display cache ({@link HistoryCache}, R9.3).
 * When the server is not reachable the cached copy is shown under a warning `StatusCard` and the
 * "Last updated 09:40" line (worker-app R6.7); it is display only and never changes what the
 * server holds. A refusal other than not-paired is the same card with the server's words.
 *
 * `HR_APP_NOT_PAIRED`, a missing pairing or an invalidated key wipes the phone and hands over to
 * the pairing screen (R3.2–R3.3, R5.9) through `onUnpaired`, like every other screen.
 *
 * The HR-module texts stay word for word (`HISTORY_FROM_CACHE`, `DUPLICATE_PUNCH`, the flag
 * sentences, `directionWords`): the web and the protocol tests share them. Everything else goes
 * through `t()` and every colour through `useTheme()`.
 *
 * Dependencies are injected ({@link HistoryScreenDeps}); `RootNavigator` wires the real client,
 * cache and store, tests pass fakes over `MemoryDatabase`.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { flagSentence } from '@stockkart/attendance-protocol';

import {
  AppText,
  elevatedCard,
  EmptyState,
  Icon,
  ROW_HEIGHT,
  ROW_ICON_CIRCLE,
  ROW_ICON_SIZE,
  StatusCard,
} from '../components';
import type { HistoryCache, HistoryEntry } from '../history/HistoryCache';
import { kolkataTime } from '../history/kolkataDates';
import { loadHistory, type HistoryClient, type HistoryLoad } from '../history/loadHistory';
import { t } from '../i18n';
import { displayDate, punchButtonLabel } from '../punch/kolkata';
import type { PairingStore } from '../state/pairingStore';
import { useTheme } from '../theme';

export interface HistoryScreenDeps {
  client: HistoryClient;
  cache: HistoryCache;
  pairingStore: Pick<PairingStore, 'wipe'>;
  /** Phone clock in epoch milliseconds; `Date.now` on the phone. */
  clock?: () => number;
}

export interface HistoryScreenProps {
  deps: HistoryScreenDeps;
  /** The pairing has ended and the phone is already wiped (R3.3): show the pairing screen. */
  onUnpaired: () => void;
}

/** Shown above the cached list when the server could not be reached (R6.1). */
export const HISTORY_FROM_CACHE =
  'The server could not be reached. Showing the punches saved on this phone.';

/** Shown under a duplicate punch (R4.8): kept in the list, greyed, not counted. */
export const DUPLICATE_PUNCH = 'Duplicate of an earlier punch';

/**
 * "Last updated 09:40" (worker-app R6.7): the phone clock of the server answer a cached list came
 * from, as `HH:mm` in Asia/Kolkata; null when no answer was ever stored. Pure.
 */
export function lastUpdatedLine(fetchedAt: number | null): string | null {
  return fetchedAt == null ? null : t('history.lastUpdated', { time: kolkataTime(fetchedAt) });
}

/** One day of the list: its `yyyy-MM-dd` date and its punches in the order they were given. */
export interface HistoryDay {
  date: string;
  entries: HistoryEntry[];
}

/**
 * The entries grouped by `localDate`, days in the order their first entry appears (newest first
 * when the list is), entries kept in their order. Pure.
 */
export function groupByDay(entries: readonly HistoryEntry[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.date === entry.localDate) {
      last.entries.push(entry);
    } else {
      days.push({ date: entry.localDate, entries: [entry] });
    }
  }
  return days;
}

type Shown =
  | { phase: 'loading' }
  | { phase: 'list'; entries: HistoryEntry[]; notice: string | null; lastUpdated: string | null }
  | { phase: 'error'; message: string };

/** A dimmed row: a duplicate the server kept but did not count (R4.8). */
const DUPLICATE_OPACITY = 0.5;

export function HistoryScreen({ deps, onUnpaired }: HistoryScreenProps) {
  const { tokens } = useTheme();
  const [shown, setShown] = useState<Shown>({ phase: 'loading' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    let load: HistoryLoad;
    try {
      load = await loadHistory({
        client: deps.client,
        cache: deps.cache,
        ...(deps.clock ? { now: deps.clock } : {}),
      });
    } catch (error) {
      if (mounted.current) {
        setShown({ phase: 'error', message: messageOf(error) });
      }
      return;
    }
    if (load.kind === 'not_paired') {
      try {
        await deps.pairingStore.wipe();
      } finally {
        onUnpaired();
      }
      return;
    }
    if (!mounted.current) {
      return;
    }
    switch (load.kind) {
      case 'server':
        setShown({ phase: 'list', entries: load.entries, notice: null, lastUpdated: null });
        return;
      case 'cache':
        setShown({
          phase: 'list',
          entries: load.entries,
          notice: HISTORY_FROM_CACHE,
          lastUpdated: lastUpdatedLine(load.fetchedAt),
        });
        return;
      case 'refused':
        setShown({
          phase: 'list',
          entries: load.entries,
          notice: load.message,
          lastUpdated: lastUpdatedLine(load.fetchedAt),
        });
        return;
    }
  }, [deps.client, deps.cache, deps.clock, deps.pairingStore, onUnpaired]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (shown.phase === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={tokens.color.brand} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  if (shown.phase === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <StatusCard title={shown.message} tone="danger" testID="history-error" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingVertical: tokens.space.sm }}
      testID="history-list"
    >
      {shown.notice ? (
        <View style={{ marginBottom: tokens.space.sm }}>
          <StatusCard title={shown.notice} tone="warning" testID="history-notice" />
        </View>
      ) : null}
      {shown.lastUpdated ? (
        <AppText
          variant="secondary"
          color="textSecondary"
          style={{ marginBottom: tokens.space.md }}
          testID="history-last-updated"
        >
          {shown.lastUpdated}
        </AppText>
      ) : null}
      {shown.entries.length === 0 ? (
        <EmptyState sentence={t('history.empty')} testID="history-empty" />
      ) : (
        groupByDay(shown.entries).map((day) => <DayCard key={day.date} day={day} />)
      )}
    </ScrollView>
  );
}

/** One day's punches: a 20 dp card headed by the date, one row per punch. */
export function DayCard({ day }: { day: HistoryDay }) {
  const { tokens, scheme } = useTheme();
  return (
    <View
      style={{
        ...elevatedCard(tokens, scheme),
        paddingHorizontal: tokens.space.md,
        paddingTop: tokens.space.md,
        paddingBottom: tokens.space.xs,
        marginBottom: tokens.space.md,
      }}
      testID={`history-day-${day.date}`}
    >
      <AppText variant="secondary" color="textSecondary" accessibilityRole="header">
        {displayDate(day.date)}
      </AppText>
      {day.entries.map((entry, index) => (
        <HistoryRow key={entry.punchId} entry={entry} last={index === day.entries.length - 1} />
      ))}
    </View>
  );
}

/** One punch: the direction icon, time, direction words, flags (R4.10). */
export function HistoryRow({ entry, last = false }: { entry: HistoryEntry; last?: boolean }) {
  const { tokens } = useTheme();
  const tone = entry.direction === 'IN' ? 'success' : 'danger';
  return (
    <View
      accessible
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        minHeight: ROW_HEIGHT,
        paddingVertical: tokens.space.sm,
        opacity: entry.counted ? 1 : DUPLICATE_OPACITY,
        ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: tokens.color.borderDefault }),
      }}
      testID={`history-row-${entry.punchId}`}
      accessibilityLabel={`${displayDate(entry.localDate)} ${entry.localTime} ${directionWords(
        entry.direction,
      )}`}
    >
      <View
        style={{
          width: ROW_ICON_CIRCLE,
          height: ROW_ICON_CIRCLE,
          borderRadius: ROW_ICON_CIRCLE / 2,
          backgroundColor: tokens.color[tone === 'success' ? 'successSoft' : 'dangerSoft'],
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: tokens.space.md,
        }}
        testID={`history-row-${entry.punchId}-icon-circle`}
      >
        <Icon
          name={entry.direction === 'IN' ? 'arrowIn' : 'arrowOut'}
          size={ROW_ICON_SIZE}
          color={tone}
          testID={`history-row-${entry.punchId}-icon`}
        />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <AppText
            color="textPrimary"
            style={{ marginRight: tokens.space.sm, fontVariant: ['tabular-nums'] }}
            testID={`history-row-${entry.punchId}-time`}
          >
            {entry.localTime}
          </AppText>
          <AppText color="textSecondary">{directionWords(entry.direction)}</AppText>
        </View>
        {entry.flags.map((flag) => (
          <AppText
            key={flag}
            variant="secondary"
            color="warning"
            style={{ marginTop: tokens.space.xs }}
          >
            {flagSentence(flag)}
          </AppText>
        ))}
        {!entry.counted ? (
          <AppText variant="secondary" color="textSecondary" style={{ marginTop: tokens.space.xs }}>
            {DUPLICATE_PUNCH}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** "Check in" / "Check out" for a punch direction, the same words as the punch button (R4.1). */
export function directionWords(direction: HistoryEntry['direction']): 'Check in' | 'Check out' {
  return punchButtonLabel(direction);
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : t('common.somethingWentWrong');
}
