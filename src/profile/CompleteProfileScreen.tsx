/**
 * Complete your profile, the stub of this version (worker-app R8.6, R8.9; design "Screen
 * inventory"): in plain words, what the shop may later ask for (Aadhaar last 4 or a Virtual ID,
 * PAN, address, a photo of each document), when (only when the shop requests it; the request shows
 * in Profile, R8.7) and the rules that will protect those details (masked, encrypted, never in
 * notifications or exports, deleted on request or 90 days after exit, R8.8). Each section is one
 * 20 dp `ListCard` whose items are `ListRow`s with a `brandSoft` icon circle (R12.15). No input
 * field exists on this screen and nothing is collected, transmitted or stored (R8.9). **Back** is
 * its one button.
 */
import { View } from 'react-native';

import { AppText, ListCard, ListRow, PrimaryButton, Screen, type IconName } from '../components';
import { t, type StringId } from '../i18n';
import { useTheme } from '../theme';

export interface CompleteProfileScreenProps {
  onBack: () => void;
}

/** The three sections of the explanation, in reading order (R8.6). */
export const COMPLETE_PROFILE_SECTIONS: readonly {
  heading: StringId;
  /** The glyph on each row's `brandSoft` circle. */
  icon: IconName;
  items: readonly StringId[];
}[] = [
  {
    heading: 'completeProfile.whatHeading',
    icon: 'document',
    items: [
      'completeProfile.whatAadhaar',
      'completeProfile.whatPan',
      'completeProfile.whatAddress',
      'completeProfile.whatDocuments',
    ],
  },
  { heading: 'completeProfile.whenHeading', icon: 'history', items: ['completeProfile.when'] },
  {
    heading: 'completeProfile.rulesHeading',
    icon: 'lock',
    items: [
      'completeProfile.ruleMasked',
      'completeProfile.ruleEncrypted',
      'completeProfile.ruleNoSharing',
      'completeProfile.ruleDeleted',
    ],
  },
];

export function CompleteProfileScreen({ onBack }: CompleteProfileScreenProps) {
  const { tokens } = useTheme();
  return (
    <Screen
      title={t('completeProfile.title')}
      scroll
      footer={
        <PrimaryButton
          label={t('completeProfile.back')}
          onPress={onBack}
          testID="complete-profile-back"
        />
      }
      testID="screen-complete-profile"
    >
      <AppText
        color="textSecondary"
        style={{ marginBottom: tokens.space.lg }}
        testID="complete-profile-intro"
      >
        {t('completeProfile.intro')}
      </AppText>
      {COMPLETE_PROFILE_SECTIONS.map((section) => (
        <View
          key={section.heading}
          style={{ marginBottom: tokens.space.lg }}
          testID={`complete-profile-${section.heading}`}
        >
          <AppText
            variant="heading"
            accessibilityRole="header"
            style={{ marginBottom: tokens.space.sm }}
          >
            {t(section.heading)}
          </AppText>
          <ListCard testID={`complete-profile-${section.heading}-card`}>
            {section.items.map((item, index) => (
              <ListRow
                key={item}
                icon={section.icon}
                label={t(item)}
                last={index === section.items.length - 1}
                testID={`complete-profile-${item}`}
              />
            ))}
          </ListCard>
        </View>
      ))}
    </Screen>
  );
}
