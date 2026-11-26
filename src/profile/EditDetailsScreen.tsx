/**
 * Edit details (worker-app R8.2, R8.3, R1.2, R1.7, R6.7; design "Screen inventory"): the worker's
 * name, phone and photo, and **Save**. The e-mail is not editable from the app.
 *
 * Save, in order and only after the fields pass the R1.2 rules on the phone:
 *
 * 1. `PUT /hr/worker/profile {name, phone}` when either changed: the server updates the account and,
 *    when a linked employee exists, the employee's name and phone with one HR history row by `self`
 *    (R8.2). Stored join requests, punches and attendance days are not touched (R8.3; server-side).
 * 2. The photo: a new pick → `PUT /users/me/photo` (already square, ≤ 512 × 512, ≤ 300 KB, R1.7);
 *    "Remove photo" on the stored one → `DELETE /users/me/photo`; otherwise nothing.
 * 3. Each step that succeeded is written to the account store at once, so a failure in a later step
 *    leaves the phone agreeing with the server about the earlier ones.
 *
 * Then the shell re-resolves and `onDone` returns to Profile. While the server is not reachable
 * the save is refused with "Couldn't reach Stockkart. Your details were not changed." and nothing
 * is changed on the phone (R6.7); a refusal is shown word for word; a 401 goes to the shell (R9.3).
 *
 * The screen imports no Expo module and no navigator: `deps` and `shell` come as props.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import type { ShellScreenProps } from '../app/screenProps';
import { PhotoField } from '../account/PhotoField';
import type { PreparedPhoto } from '../account/photo';
import { accountErrorText } from '../account/session';
import { validateName, validatePhone } from '../account/validation';
import { AppText, FormField, PrimaryButton, Screen, TextButton } from '../components';
import { t } from '../i18n';
import { useAvatarSource } from '../join/screenSupport';
import type { AccountProfile } from '../state/authStore';
import { useTheme } from '../theme';

export interface EditDetailsScreenProps extends ShellScreenProps {
  profile: AccountProfile | null;
  /** Saved or cancelled: back to Profile. */
  onDone: () => void;
}

/** What Save does with the photo (see the module note). */
export type PhotoChange =
  | { kind: 'keep' }
  | { kind: 'replace'; photo: PreparedPhoto }
  | { kind: 'remove' };

export function EditDetailsScreen({ deps, shell, profile, onDone }: EditDetailsScreenProps) {
  const { tokens } = useTheme();
  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [photoChange, setPhotoChange] = useState<PhotoChange>({ kind: 'keep' });
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existing = useAvatarSource(
    deps.account,
    photoChange.kind === 'keep' ? profile?.photoUrl : undefined,
  );

  const save = useCallback(async () => {
    if (busy) {
      return;
    }
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const nameProblem = validateName(trimmedName);
    const phoneProblem = validatePhone(trimmedPhone);
    setNameError(nameProblem ? t(nameProblem) : null);
    setPhoneError(phoneProblem ? t(phoneProblem) : null);
    if (nameProblem || phoneProblem) {
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const detailsChanged =
        trimmedName !== profile?.name || trimmedPhone !== (profile?.phone ?? '');
      if (detailsChanged) {
        const saved = await deps.account.updateProfile({ name: trimmedName, phone: trimmedPhone });
        await deps.authStore.updateProfile({
          name: saved.name,
          phone: saved.phone ?? trimmedPhone,
        });
      }
      if (photoChange.kind === 'replace') {
        const uploaded = await deps.account.uploadPhoto({
          uri: photoChange.photo.uri,
          contentType: photoChange.photo.contentType,
        });
        await deps.authStore.updateProfile({ photoUrl: uploaded.photoUrl });
      } else if (photoChange.kind === 'remove') {
        await deps.account.deletePhoto();
        await deps.authStore.updateProfile({ photoUrl: undefined });
      }
      await shell.refresh();
      onDone();
    } catch (error) {
      if (!shell.handleError(error)) {
        setMessage(accountErrorText(error, t('editDetails.notReachable')));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, deps, name, onDone, phone, photoChange, profile, shell]);

  return (
    <Screen
      title={t('editDetails.title')}
      scroll
      footer={
        <PrimaryButton
          label={t('editDetails.save')}
          onPress={() => void save()}
          loading={busy}
          testID="edit-details-save"
        />
      }
      testID="screen-edit-details"
    >
      <FormField
        label={t('createAccount.fullName')}
        value={name}
        onChangeText={(text) => {
          setName(text);
          setNameError(null);
        }}
        error={nameError ?? undefined}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        editable={!busy}
        testID="edit-details-name"
      />
      <FormField
        label={t('createAccount.phone')}
        value={phone}
        onChangeText={(text) => {
          setPhone(text);
          setPhoneError(null);
        }}
        error={phoneError ?? undefined}
        helper={t('createAccount.phoneHelper')}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        editable={!busy}
        testID="edit-details-phone"
      />
      <PhotoField
        name={name}
        photo={photoChange.kind === 'replace' ? photoChange.photo : null}
        onChange={(photo) => setPhotoChange(photo ? { kind: 'replace', photo } : { kind: 'keep' })}
        existing={photoChange.kind === 'keep' ? existing : undefined}
        onRemoveExisting={() => setPhotoChange({ kind: 'remove' })}
        modules={deps.photo}
        disabled={busy}
        testID="edit-details-photo"
      />
      {message ? (
        <AppText
          variant="secondary"
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="edit-details-message"
        >
          {message}
        </AppText>
      ) : null}
      <View style={{ marginBottom: tokens.space.sm }}>
        <TextButton
          label={t('common.cancel')}
          onPress={onDone}
          disabled={busy}
          testID="edit-details-cancel"
        />
      </View>
    </Screen>
  );
}
