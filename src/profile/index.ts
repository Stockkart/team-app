/**
 * The Profile module (worker-app task 14.4): Profile (R8.1, R8.5, R8.7, R5.3, R5.4, R7.7, R12.10),
 * Edit details (R8.2) and the Complete your profile stub (R8.6), plus the Theme row they share.
 * Log out itself lives in `src/account/logout.ts`; Remove this phone runs the HR-module
 * `src/settings/removePhone.ts` unchanged.
 */
export { ProfileScreen, type ProfileScreenProps } from './ProfileScreen';
export {
  EditDetailsScreen,
  type EditDetailsScreenProps,
  type PhotoChange,
} from './EditDetailsScreen';
export {
  COMPLETE_PROFILE_SECTIONS,
  CompleteProfileScreen,
  type CompleteProfileScreenProps,
} from './CompleteProfileScreen';
export { THEME_LABELS, ThemeChoice, type ThemeChoiceProps } from './ThemeChoice';
