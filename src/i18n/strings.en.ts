/**
 * Every sentence, label and button text the Stockkart Team app shows, keyed by id (R12.11, R12.12). One
 * flat object; screens never hold a string literal (the `react/jsx-no-literals` and
 * `no-restricted-syntax` rules in `eslint.config.mjs`) and reach these through `t()` only.
 *
 * Ids are `screen.element` (or `common.*`, `module.*`, `banner.*`, `validation.*`). A `{name}`
 * inside a value is a placeholder `t()` fills from its `params`. English is the only language
 * shipped in this version; a Hindi file would have the same ids (R12.12).
 *
 * Not here on purpose: the texts the server decides (`ErrorCode` messages such as "You are
 * already part of a shop. Leave it first." or "This code is for a different employee. Ask your
 * manager."). They arrive in `data.message` and are shown word for word; their mirrors for tests
 * live in `@stockkart/attendance-protocol` (`messages.ts`, `worker-messages.ts`). The
 * HR-module punch, pairing and history sentences stay in `attendance-protocol/messages.ts` too,
 * because the web and the protocol tests share them.
 */
export const STRINGS_EN = {
  // --- shared ---
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.logOut': 'Log out',
  'common.logOutQuestion': 'Log out of Stockkart?',
  'common.logOutExplanation':
    'Your details are removed from this phone. Your check-in pairing stays, so signing in again needs no new code.',
  'common.loading': 'Loading',
  'common.notReachable': "Couldn't reach Stockkart. Try again when you have network.",
  'common.somethingWentWrong': 'Something went wrong. Try again.',
  'common.appName': 'Stockkart Team',

  // --- field validation, app side first (R1.2) ---
  'validation.name': 'Enter your full name (2 to 100 characters).',
  'validation.email': 'Enter a valid email address.',
  'validation.password': 'Enter a password of at least 8 characters.',
  'validation.phone': 'Enter a 10-digit mobile number.',

  // --- Sign in (R1.1, R1.6, R9.3) ---
  'signIn.email': 'Email',
  'signIn.password': 'Password',
  'signIn.submit': 'Sign in',
  'signIn.google': 'Continue with Google',
  'signIn.googleUnavailable':
    'Google sign-in is not available on this phone. Use your email and password.',
  'signIn.forgotPassword': 'Forgot password?',
  'signIn.createAccount': 'Create account',
  'signIn.sessionEnded': 'Your session ended. Sign in again.',
  'signIn.notReachable': "Couldn't reach Stockkart. Check your connection and try again.",

  // --- Create account (R1.2, R1.3, R1.7, R1.9) ---
  'createAccount.title': 'Create account',
  'createAccount.fullName': 'Full name',
  'createAccount.email': 'Email',
  'createAccount.password': 'Password',
  'createAccount.phone': 'Phone number',
  'createAccount.phoneHelper': "We'll use this number for your shop to contact you",
  'createAccount.photo': 'Photo (optional)',
  'createAccount.removePhoto': 'Remove photo',
  'createAccount.takePhoto': 'Take a photo',
  'createAccount.chooseFromGallery': 'Choose from gallery',
  'createAccount.submit': 'Create account',
  'createAccount.google': 'Continue with Google',
  'createAccount.signInInstead': 'Sign in instead',
  'createAccount.notReachable': "Couldn't reach Stockkart. Check your connection and try again.",

  // --- the photo picker (R1.7) ---
  'photo.unsupported': 'Choose a JPEG or PNG photo.',
  'photo.denied': "Allow Stockkart to use the camera or your photos in the phone's settings.",
  'photo.tooLarge': 'That photo is too detailed to upload. Try another one.',

  // --- Phone and photo: Google sign-up (R1.4, R1.10, R1.13) and "Add your phone number" (R1.11) ---
  'phoneAndPhoto.title': 'Almost done, {name}',
  'phoneAndPhoto.titleNoName': 'Almost done',
  'phoneAndPhoto.updateTitle': 'Add your phone number',
  'phoneAndPhoto.phone': 'Phone number',
  'phoneAndPhoto.submit': 'Create account',
  'phoneAndPhoto.save': 'Save',
  'phoneAndPhoto.googleExpired': 'Google sign-in expired. Try again.',

  // --- Join a shop (R3.1–R3.4, R4.12) ---
  'join.title': 'Join a shop',
  'join.greeting': 'Hello, {name}',
  'join.ownerEmail': "Shop owner's email",
  'join.findShop': 'Find shop',
  'join.result': '{shopName} · owner {ownerFirstName}',
  'join.pickShop': 'Which shop is yours?',
  'join.yesMyShop': 'Yes, this is my shop',
  'join.notMyShop': 'Not my shop',
  'join.notFound': "We couldn't find a shop for that email. Check it with your manager.",
  'join.rejected': '{shopName} did not accept your request',
  'join.askAnotherShop': 'Ask another shop',

  // --- Waiting (R3.5, R3.6, R6.3) ---
  'waiting.title': 'Waiting for {shopName} to accept you',
  'waiting.requestedOn': 'Requested on {date}',
  'waiting.withdraw': 'Withdraw request',
  'waiting.withdrawQuestion': 'Withdraw your request to join {shopName}?',

  // --- Blocked (R5.6) and account switch (R9.7) ---
  'blocked.staffNoEmployee':
    'This app is for workers. Ask your manager to link your login to your employee record from the Employees page.',
  'switchAccount.question': 'Switch account?',
  'switchAccount.explanation':
    'This phone is paired to another record. Switching removes that pairing from this phone.',
  'switchAccount.lostPunchesOne': '1 punch that was not yet sent will be lost',
  'switchAccount.lostPunches': '{count} punches that were not yet sent will be lost',
  'switchAccount.confirm': 'Switch account',

  // --- Offline (R6.7) ---
  'offline.title': "Couldn't reach Stockkart. Try again when you have network.",
  'offline.retry': 'Retry',

  // --- Home and the module grid (R6.4–R6.6, R12.16) ---
  'home.goodMorning': 'Good morning',
  'home.goodAfternoon': 'Good afternoon',
  'home.goodEvening': 'Good evening',
  'home.greeting': '{greeting}, {name}',
  'home.notCheckedIn': 'Not checked in',
  'home.checkedIn': 'Checked in {in}',
  'home.checkedInOut': 'Checked in {in} · out {out}',
  'module.attendance': 'Attendance',
  'module.history': 'History',
  'module.profile': 'Profile',
  'module.updateApp': 'Update the app to use this.',

  // --- Notification banners (R10.1, R12.9) ---
  'banner.more': 'and {count} more',
  'banner.markedRead': 'Notification marked as read',

  // --- Attendance module (R7.1, R7.2) ---
  'attendance.title': 'Attendance',
  'attendance.notEnabledTitle': 'Enable biometric check-in.',
  'attendance.notEnabledLine': 'Ask your manager for a code.',
  'attendance.haveCode': 'I have a code',

  // --- Check-in screen (R7.10–R7.13) ---
  'punch.checkIn': 'Check in',
  'punch.checkOut': 'Check out',
  'punch.notCheckedInYet': 'Not checked in yet',
  'punch.inSince': 'In since {time}',
  'punch.doneForToday': 'Done for today · {duration}',
  'punch.duration': '{hours} h {minutes} m',
  'punch.todayTitle': 'Today',
  'punch.noCheckInYetToday': 'No check-in yet today',
  'punch.worked': 'Worked {duration}',
  'punch.rowIn': 'IN',
  'punch.rowOut': 'OUT',
  'punch.rowArrow': '→',
  'punch.rowMissingOut': '—',
  'punch.rowLabel': 'IN {inTime} → OUT {outTime}',
  'punch.locationInside': 'Inside shop',
  'punch.locationOutside': 'Outside shop',
  'punch.locationChecking': 'Checking…',
  'punch.locationOff': 'Location off',
  'punch.locationChipLabel': 'Location: {text}',
  'punch.biometricReady': 'Fingerprint ready',
  'punch.biometricNotSetUp': 'Not set up',
  'punch.biometricChipLabel': 'Biometric: {text}',

  // --- History module (R6.7, R7.9, R12.6) ---
  'history.title': 'History',
  'history.lastUpdated': 'Last updated {time}',
  'history.empty': 'No check-ins in the last 31 days',

  // --- Profile (R8.1, R8.5, R8.7, R5.3, R5.4, R7.7, R12.10) ---
  'profile.title': 'Profile',
  'profile.phone': 'Phone',
  'profile.email': 'Email',
  'profile.shop': 'Shop',
  'profile.employeeCode': 'Employee code',
  'profile.joinDate': 'Join date',
  'profile.editDetails': 'Edit details',
  'profile.completeProfile': 'Complete your profile',
  'profile.profileRequestedBadge': 'Your shop has asked for your details',
  'profile.theme': 'Theme',
  'profile.themeSystem': 'System',
  'profile.themeLight': 'Light',
  'profile.themeDark': 'Dark',
  'profile.removePhone': 'Remove this phone',
  'profile.removePhoneQuestion': 'Remove this phone?',
  'profile.removePhoneExplanation':
    'Your shop will no longer accept check-ins from this phone, and everything the Attendance app saved on it is deleted. A manager can pair it again.',
  'profile.removePhoneConfirm': 'Yes, remove',
  'profile.leaveShop': 'Leave this shop',
  'profile.leaveShopQuestion': 'Leave {shopName}?',
  'profile.leaveShopExplanation': 'Your attendance here will stop today.',
  'profile.leaveShopConfirm': 'Leave this shop',
  'profile.appVersion': 'Version {version}',

  // --- Edit details (R8.2) ---
  'editDetails.title': 'Edit details',
  'editDetails.save': 'Save',
  'editDetails.notReachable': "Couldn't reach Stockkart. Your details were not changed.",

  // --- Complete your profile, stub (R8.6) ---
  'completeProfile.title': 'Complete your profile',
  'completeProfile.intro':
    'Your shop may later ask you for these details. Nothing is collected in this version.',
  'completeProfile.whatHeading': 'What your shop may ask for',
  'completeProfile.whatAadhaar':
    'Your Aadhaar number. Only the last 4 digits or a Virtual ID are stored, never the full number.',
  'completeProfile.whatPan': 'Your PAN.',
  'completeProfile.whatAddress': 'Your address.',
  'completeProfile.whatDocuments': 'A photo of each document.',
  'completeProfile.whenHeading': 'When',
  'completeProfile.when': 'Only when your shop requests it. You will see the request here.',
  'completeProfile.rulesHeading': 'How your details are protected',
  'completeProfile.ruleMasked':
    'Aadhaar and PAN are shown masked everywhere, with only the last 4 characters visible.',
  'completeProfile.ruleEncrypted': 'Your PAN, address and document photos are stored encrypted.',
  'completeProfile.ruleNoSharing':
    'They are never put in notifications, exports or messages to anyone.',
  'completeProfile.ruleDeleted':
    'They are deleted when you ask, or 90 days after you leave the shop, whichever comes first.',
  'completeProfile.back': 'Back',
} as const satisfies Record<string, string>;

/** An id in {@link STRINGS_EN}. */
export type StringId = keyof typeof STRINGS_EN;

/** Every id, in file order. */
export const STRING_IDS = Object.keys(STRINGS_EN) as readonly StringId[];
