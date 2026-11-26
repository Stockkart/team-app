/**
 * The profile photo from the camera or the gallery to the bytes the server accepts (worker-app
 * R1.7; design "Photo", Property 25):
 *
 * 1. **Pick**: `expo-image-picker` with `allowsEditing` and `aspect [1, 1]`, so the worker crops a
 *    square on the phone; images only, and only JPEG or PNG (any other type is refused here).
 * 2. **Shrink**: `expo-image-manipulator` resizes the crop to fit {@link MAX_PHOTO_SIDE} × the same
 *    and encodes it as JPEG, trying the quality ladder {@link PHOTO_QUALITIES} (0.85, then 0.7,
 *    then 0.55) until the output is at most {@link MAX_PHOTO_BYTES} (300 KB). {@link shrinkToLimit}
 *    is that rule, pure: the first quality whose output fits, or the last quality.
 * 3. **Upload**: the caller hands the result to `AccountClient.uploadPhoto` as `PUT /users/me/photo`.
 *
 * The original is never kept or sent: the result carries the encoded file's URI only; the picker's
 * URI is read once by the manipulator and dropped. The server refuses what does not fit (it does
 * not resize), so the phone does the work.
 *
 * Pure apart from the two injected modules ({@link PhotoModules}): tests pass scripted ones, the
 * composition root passes `./expoPhoto.ts`.
 */

/** The server's limits (`UserPhotoService`): longest side and byte size (R1.7). */
export const MAX_PHOTO_SIDE = 512;
export const MAX_PHOTO_BYTES = 300 * 1024;

/** JPEG qualities tried in order until the encoded photo fits (design "Photo"). */
export const PHOTO_QUALITIES: readonly number[] = [0.85, 0.7, 0.55];

/** What the server accepts as input (R1.7). The upload itself is always JPEG after step 2. */
export const ACCEPTED_PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

/** Where the worker takes the photo from. */
export type PhotoSource = 'camera' | 'library';

/** What the picker gave: the cropped image's file and, when the platform knows it, its type. */
export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  /** `image/jpeg`, `image/png`, …; absent when the platform did not say. */
  mimeType?: string;
}

/** The picker, narrowed to what this module needs. */
export interface PhotoPickerModule {
  /** Opens the camera or the gallery with a square crop. `cancelled` when the worker backed out. */
  pick(
    source: PhotoSource,
  ): Promise<{ kind: 'picked'; image: PickedImage } | { kind: 'cancelled' } | { kind: 'denied' }>;
}

/** One JPEG encoding of an image: its file and size. */
export interface EncodedImage {
  uri: string;
  width: number;
  height: number;
  bytes: number;
}

/** The manipulator, narrowed to what this module needs. */
export interface PhotoManipulatorModule {
  /**
   * Resizes `image` to fit `maxSide × maxSide` (keeping the ratio, never enlarging) and encodes it
   * as JPEG at `quality`.
   */
  encodeJpeg(image: PickedImage, maxSide: number, quality: number): Promise<EncodedImage>;
}

export interface PhotoModules {
  picker: PhotoPickerModule;
  manipulator: PhotoManipulatorModule;
}

/** The photo ready for `AccountClient.uploadPhoto`: square, ≤ 512 × 512, ≤ 300 KB, JPEG. */
export interface PreparedPhoto {
  uri: string;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  /** The quality the ladder stopped at. */
  quality: number;
}

export type PreparePhotoResult =
  | { kind: 'photo'; photo: PreparedPhoto }
  /** The worker closed the camera or the gallery without choosing. */
  | { kind: 'cancelled' }
  /** The phone refused camera or photo access. */
  | { kind: 'denied' }
  /** Not a JPEG or PNG (R1.7). */
  | { kind: 'unsupported' }
  /** Even the last quality is over the limit (an unusually detailed 512 × 512 image). */
  | { kind: 'too_large' };

/**
 * The quality ladder (Property 25, phone half): encodes at each quality in order and answers the
 * first whose output is at most `limit` bytes, or the last quality's output when none fits.
 * `encodeAt` is called once per quality tried, never for the qualities after the one that fits.
 * Works with a synchronous `encodeAt` too (tests).
 */
export async function shrinkToLimit<R extends { bytes: number }>(
  encodeAt: (quality: number) => R | Promise<R>,
  qualities: readonly number[] = PHOTO_QUALITIES,
  limit: number = MAX_PHOTO_BYTES,
): Promise<{ quality: number; result: R }> {
  if (qualities.length === 0) {
    throw new Error('the quality ladder is empty');
  }
  let last: { quality: number; result: R } | undefined;
  for (const quality of qualities) {
    const result = await encodeAt(quality);
    last = { quality, result };
    if (result.bytes <= limit) {
      return last;
    }
  }
  // `qualities` has at least one entry, so `last` is set.
  return last as { quality: number; result: R };
}

/** True when the picked image's type is one the server accepts, or unknown (the encoder decides). */
export function isAcceptedPhotoType(mimeType: string | undefined): boolean {
  return mimeType === undefined || ACCEPTED_PHOTO_TYPES.includes(mimeType.toLowerCase());
}

/** Pick, crop, shrink: the whole of R1.7 on the phone. */
export async function preparePhoto(
  modules: PhotoModules,
  source: PhotoSource,
): Promise<PreparePhotoResult> {
  const picked = await modules.picker.pick(source);
  if (picked.kind !== 'picked') {
    return picked;
  }
  if (!isAcceptedPhotoType(picked.image.mimeType)) {
    return { kind: 'unsupported' };
  }
  const { quality, result } = await shrinkToLimit((q) =>
    modules.manipulator.encodeJpeg(picked.image, MAX_PHOTO_SIDE, q),
  );
  if (result.bytes > MAX_PHOTO_BYTES) {
    return { kind: 'too_large' };
  }
  return {
    kind: 'photo',
    photo: {
      uri: result.uri,
      contentType: 'image/jpeg',
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      quality,
    },
  };
}

/** Bytes a base64 text (with or without `=` padding, no line breaks) encodes. */
export function base64ByteLength(base64: string): number {
  const text = base64.replace(/\s+/g, '');
  if (text.length === 0) {
    return 0;
  }
  let padding = 0;
  if (text.endsWith('==')) {
    padding = 2;
  } else if (text.endsWith('=')) {
    padding = 1;
  }
  return Math.floor((text.length * 3) / 4) - padding;
}
