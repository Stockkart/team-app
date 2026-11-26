/**
 * The app's real {@link PhotoModules}: `expo-image-picker` for the square crop from the camera or
 * the gallery and `expo-image-manipulator` for the resize and the JPEG ladder (R1.7, design
 * "Photo"). Import this from the composition root only; tests pass scripted modules to
 * `preparePhoto` and never load this file (it needs the React Native runtime).
 *
 * The encoder asks for the result as base64 only to measure it ({@link base64ByteLength}); the
 * bytes are not kept, and the upload reads the encoded file by its URI (`AccountClient.uploadPhoto`).
 */
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  base64ByteLength,
  type PhotoManipulatorModule,
  type PhotoModules,
  type PhotoPickerModule,
  type PhotoSource,
} from './photo';

/** The picker options every pick uses: one square-cropped image, no video. */
const PICK_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
  allowsMultipleSelection: false,
  exif: false,
};

const expoPicker: PhotoPickerModule = {
  async pick(source: PhotoSource) {
    // Only the camera needs a runtime permission. The library opens the system photo picker
    // (`PickVisualMedia` on Android, `PHPicker` on iOS), which hands over the one chosen image
    // without any storage permission; `app.json` blocks `READ_EXTERNAL_STORAGE` on purpose, so
    // asking `requestMediaLibraryPermissionsAsync` here would be refused outright on Android 9–12
    // and the gallery would never open.
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return { kind: 'denied' as const };
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(PICK_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PICK_OPTIONS);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) {
      return { kind: 'cancelled' as const };
    }
    return {
      kind: 'picked' as const,
      image: {
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      },
    };
  },
};

const expoManipulator: PhotoManipulatorModule = {
  async encodeJpeg(image, maxSide, quality) {
    // Fit the longer side to maxSide without enlarging a smaller image; the other side follows
    // from the ratio (the crop is square, so both end up ≤ maxSide).
    const longer = Math.max(image.width, image.height);
    const target = longer > 0 ? Math.min(maxSide, longer) : maxSide;
    const resize = image.height > image.width ? { height: target } : { width: target };
    const result = await manipulateAsync(image.uri, [{ resize }], {
      compress: quality,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      bytes: base64ByteLength(result.base64 ?? ''),
    };
  },
};

export const expoPhotoModules: PhotoModules = { picker: expoPicker, manipulator: expoManipulator };
