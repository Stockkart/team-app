/**
 * The Today card of the check-in screen (design "Check-in screen", R7.12, R12.15): an elevated
 * card (`radius.card`, light shadow / dark edge) headed "Today" with the day's counted punches as a
 * timeline — one row per IN, "IN 09:12 → OUT 18:05" with IN in `success`, OUT in `danger`, the
 * times in `textPrimary` and "—" in `textSecondary` for a missing OUT (`todayRows`) — and a footer
 * "Worked 8 h 05 m" (`workedDuration`). With no punch the card shows the one sentence "No check-in
 * yet today". Each row is one TalkBack element.
 */
import { View } from 'react-native';

import { t } from '../i18n';
import {
  formatDuration,
  todayRows,
  workedDuration,
  type TodayPunch,
  type TodayRow,
} from '../punch/punchScreen';
import { useTheme } from '../theme';
import { AppText } from './AppText';
import { elevatedCard } from './surfaces';

export interface TodayCardProps {
  punches: readonly TodayPunch[];
  testID?: string;
}

export function TodayCard({ punches, testID }: TodayCardProps) {
  const { tokens, scheme } = useTheme();
  const rows = todayRows(punches);
  const worked = workedDuration(punches);

  return (
    <View style={{ ...elevatedCard(tokens, scheme), padding: tokens.space.md }} testID={testID}>
      <AppText variant="heading" color="textPrimary" accessibilityRole="header">
        {t('punch.todayTitle')}
      </AppText>
      {rows.length === 0 ? (
        <AppText
          color="textSecondary"
          style={{ marginTop: tokens.space.sm }}
          testID={testID ? `${testID}-empty` : undefined}
        >
          {t('punch.noCheckInYetToday')}
        </AppText>
      ) : (
        rows.map((row, index) => (
          <Row
            key={`${index}-${row.in}`}
            row={row}
            testID={testID ? `${testID}-row-${index}` : undefined}
          />
        ))
      )}
      {worked !== undefined ? (
        <AppText
          color="textSecondary"
          style={{ marginTop: tokens.space.sm }}
          testID={testID ? `${testID}-worked` : undefined}
        >
          {t('punch.worked', { duration: formatDuration(worked) })}
        </AppText>
      ) : null}
    </View>
  );
}

function Row({ row, testID }: { row: TodayRow; testID?: string }) {
  const { tokens } = useTheme();
  const outTime = row.out ?? t('punch.rowMissingOut');
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('punch.rowLabel', { inTime: row.in, outTime })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: tokens.space.sm,
      }}
      testID={testID}
    >
      <AppText variant="secondary" color="success" style={{ marginRight: tokens.space.xs }}>
        {t('punch.rowIn')}
      </AppText>
      <AppText color="textPrimary" style={{ marginRight: tokens.space.sm }}>
        {row.in}
      </AppText>
      <AppText color="textSecondary" style={{ marginRight: tokens.space.sm }}>
        {t('punch.rowArrow')}
      </AppText>
      <AppText variant="secondary" color="danger" style={{ marginRight: tokens.space.xs }}>
        {t('punch.rowOut')}
      </AppText>
      <AppText
        color={row.out ? 'textPrimary' : 'textSecondary'}
        testID={testID ? `${testID}-out` : undefined}
      >
        {outTime}
      </AppText>
    </View>
  );
}
