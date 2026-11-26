/**
 * The optional photo of the account forms (R1.7; design "Create account", "Phone and photo", "Edit
 * details"): the current choice as a 96 dp `Avatar` on a `brandSoft` disc (the worker's initial in
 * `brand` until a photo is chosen) with a small peach camera badge on its corner (an `accent`
 * circle, the glyph in `textOnAccent`, R12.14), then "Take a photo" and "Choose from gallery", and
 * "Remove photo" once one is set. Picking runs `preparePhoto` (square crop → ≤ 512 × 512 → JPEG
 * ladder ≤ 300 KB); the field holds the prepared file only, never the original. A refused pick
 * (not JPEG or PNG, access denied, still too large) is said under the field in `danger`; a
 * cancelled one changes nothing. The badge is decoration: the buttons are the controls.
 *
 * Edit details (R8.2) also passes `existing`: the account's current photo, drawn through its
 * authenticated source while nothing new is picked. "Remove photo" then means one of two things:
 * with a pick present it clears the pick (`onChange(null)`), without one it asks to remove the
 * stored photo (`onRemoveExisting`). The screen decides what each means for the save.
 */
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  Avatar,
  Icon,
  PHOTO_BADGE_ICON_SIZE,
  PHOTO_BADGE_SIZE,
  PHOTO_PREVIEW_SIZE,
  TextButton,
} from '../components';
import { t } from '../i18n';
import { useTheme } from '../theme';
import { preparePhoto, type PhotoModules, type PhotoSource, type PreparedPhoto } from './photo';

export interface PhotoFieldProps {
  /** For the initial shown until a photo is chosen. */
  name: string;
  photo: PreparedPhoto | null;
  onChange: (photo: PreparedPhoto | null) => void;
  modules: PhotoModules;
  /** The account's stored photo, shown while `photo` is null (Edit details, R8.2). */
  existing?: { uri: string; headers?: Record<string, string> } | null;
  /** "Remove photo" while `existing` is shown and nothing is picked. */
  onRemoveExisting?: () => void;
  /** Taps are ignored while the form is being sent. */
  disabled?: boolean;
  testID?: string;
}

type PhotoProblem = 'photo.unsupported' | 'photo.denied' | 'photo.tooLarge';

export function PhotoField({
  name,
  photo,
  onChange,
  modules,
  existing,
  onRemoveExisting,
  disabled,
  testID,
}: PhotoFieldProps) {
  const { tokens } = useTheme();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);

  const pick = async (source: PhotoSource) => {
    if (busy || disabled) {
      return;
    }
    setBusy(true);
    try {
      const result = await preparePhoto(modules, source);
      if (result.kind === 'photo') {
        setProblem(null);
        onChange(result.photo);
      } else if (result.kind === 'unsupported') {
        setProblem('photo.unsupported');
      } else if (result.kind === 'denied') {
        setProblem('photo.denied');
      } else if (result.kind === 'too_large') {
        setProblem('photo.tooLarge');
      }
    } finally {
      setBusy(false);
    }
  };

  const inactive = busy || disabled === true;
  const shown = photo ? { uri: photo.uri } : existing ?? undefined;

  return (
    <View style={{ marginBottom: tokens.space.md }} testID={testID}>
      <AppText variant="secondary" color="textSecondary" style={{ marginBottom: tokens.space.xs }}>
        {t('createAccount.photo')}
      </AppText>
      <View style={{ alignItems: 'center', marginBottom: tokens.space.sm }}>
        <View
          style={{ width: PHOTO_PREVIEW_SIZE, height: PHOTO_PREVIEW_SIZE }}
          testID={testID ? `${testID}-picker` : undefined}
        >
          <Avatar
            name={name}
            accessibilityLabel={name.trim() === '' ? t('createAccount.photo') : name}
            size={PHOTO_PREVIEW_SIZE}
            variant="onSoft"
            uri={shown?.uri}
            headers={shown?.headers}
            testID={testID ? `${testID}-preview` : undefined}
          />
          {/* The peach camera badge: decoration on the picker's corner (R12.14: peach is a fill). */}
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: PHOTO_BADGE_SIZE,
              height: PHOTO_BADGE_SIZE,
              borderRadius: PHOTO_BADGE_SIZE / 2,
              backgroundColor: tokens.color.accent,
              borderWidth: 2,
              borderColor: tokens.color.bgCanvas,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            testID={testID ? `${testID}-badge` : undefined}
          >
            <Icon
              name="camera"
              size={PHOTO_BADGE_ICON_SIZE}
              color="textOnAccent"
              testID={testID ? `${testID}-badge-icon` : undefined}
            />
          </View>
        </View>
      </View>
      <TextButton
        label={t('createAccount.takePhoto')}
        onPress={() => void pick('camera')}
        disabled={inactive}
        testID={testID ? `${testID}-camera` : undefined}
      />
      <TextButton
        label={t('createAccount.chooseFromGallery')}
        onPress={() => void pick('library')}
        disabled={inactive}
        testID={testID ? `${testID}-gallery` : undefined}
      />
      {photo || existing ? (
        <TextButton
          label={t('createAccount.removePhoto')}
          onPress={() => {
            setProblem(null);
            if (photo) {
              onChange(null);
            } else {
              onRemoveExisting?.();
            }
          }}
          disabled={inactive}
          testID={testID ? `${testID}-remove` : undefined}
        />
      ) : null}
      {problem ? (
        <AppText
          variant="secondary"
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginTop: tokens.space.xs }}
          testID={testID ? `${testID}-error` : undefined}
        >
          {t(problem)}
        </AppText>
      ) : null}
    </View>
  );
}
