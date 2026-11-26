import { describe, expect, it, vi } from 'vitest';

import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIDE,
  PHOTO_QUALITIES,
  base64ByteLength,
  isAcceptedPhotoType,
  preparePhoto,
  shrinkToLimit,
  type EncodedImage,
  type PhotoModules,
  type PickedImage,
} from './photo';

const KB = 1024;

describe('the limits (R1.7)', () => {
  it('are the server’s: 512 px, 300 KB, JPEG or PNG in, the ladder 0.85 → 0.7 → 0.55', () => {
    expect(MAX_PHOTO_SIDE).toBe(512);
    expect(MAX_PHOTO_BYTES).toBe(300 * KB);
    expect(ACCEPTED_PHOTO_TYPES).toEqual(['image/jpeg', 'image/png']);
    expect(PHOTO_QUALITIES).toEqual([0.85, 0.7, 0.55]);
  });
});

describe('shrinkToLimit (design "Photo", Property 25 phone half)', () => {
  const sizes: Record<number, number> = { 0.85: 420 * KB, 0.7: 290 * KB, 0.55: 180 * KB };

  it('answers the first quality whose output fits, and encodes nothing after it', async () => {
    const encodeAt = vi.fn((quality: number) => ({ bytes: sizes[quality] }));
    const out = await shrinkToLimit(encodeAt);
    expect(out).toEqual({ quality: 0.7, result: { bytes: 290 * KB } });
    expect(encodeAt.mock.calls.map(([q]) => q)).toEqual([0.85, 0.7]);
  });

  it('answers the first quality at once when it already fits', async () => {
    const encodeAt = vi.fn(async () => ({ bytes: 100 * KB }));
    expect(await shrinkToLimit(encodeAt)).toEqual({ quality: 0.85, result: { bytes: 100 * KB } });
    expect(encodeAt).toHaveBeenCalledTimes(1);
  });

  it('answers the last quality when none fits', async () => {
    const encodeAt = vi.fn((quality: number) => ({ bytes: 500 * KB, quality }));
    const out = await shrinkToLimit(encodeAt);
    expect(out.quality).toBe(0.55);
    expect(out.result.bytes).toBe(500 * KB);
    expect(encodeAt).toHaveBeenCalledTimes(3);
  });

  it('takes a ladder and a limit of its own, and refuses an empty ladder', async () => {
    const out = await shrinkToLimit((q) => ({ bytes: q * 1000 }), [0.9, 0.5, 0.1], 600);
    expect(out.quality).toBe(0.5);
    await expect(shrinkToLimit(() => ({ bytes: 0 }), [])).rejects.toThrow(/empty/);
  });
});

describe('isAcceptedPhotoType', () => {
  it('accepts JPEG and PNG (any case) and an unknown type; refuses the rest', () => {
    expect(isAcceptedPhotoType('image/jpeg')).toBe(true);
    expect(isAcceptedPhotoType('IMAGE/PNG')).toBe(true);
    expect(isAcceptedPhotoType(undefined)).toBe(true);
    expect(isAcceptedPhotoType('image/gif')).toBe(false);
    expect(isAcceptedPhotoType('image/webp')).toBe(false);
  });
});

describe('base64ByteLength', () => {
  it.each([
    ['', 0],
    ['QQ==', 1],
    ['QUI=', 2],
    ['QUJD', 3],
    ['QUJDRA==', 4],
    ['QUJD\nRA==', 4],
  ])('%j → %d bytes', (text, bytes) => {
    expect(base64ByteLength(text)).toBe(bytes);
  });
});

describe('preparePhoto', () => {
  const picked: PickedImage = {
    uri: 'file:///cache/original.jpg',
    width: 2000,
    height: 2000,
    mimeType: 'image/jpeg',
  };

  function modules(
    pick: Awaited<ReturnType<PhotoModules['picker']['pick']>>,
    bytesAt: (quality: number) => number,
  ): PhotoModules & { encodeJpeg: ReturnType<typeof vi.fn> } {
    const encodeJpeg = vi.fn(
      async (image: PickedImage, maxSide: number, quality: number): Promise<EncodedImage> => ({
        uri: `file:///cache/encoded-${quality}.jpg`,
        width: Math.min(maxSide, image.width),
        height: Math.min(maxSide, image.height),
        bytes: bytesAt(quality),
      }),
    );
    return {
      picker: { pick: vi.fn(async () => pick) },
      manipulator: { encodeJpeg },
      encodeJpeg,
    };
  }

  it('picks, shrinks to 512 and the ladder, and answers the encoded file only (never the original)', async () => {
    const m = modules({ kind: 'picked', image: picked }, (q) => (q > 0.8 ? 350 * KB : 200 * KB));
    const out = await preparePhoto(m, 'camera');
    expect(m.picker.pick).toHaveBeenCalledWith('camera');
    expect(m.encodeJpeg.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [512, 0.85],
      [512, 0.7],
    ]);
    expect(out).toEqual({
      kind: 'photo',
      photo: {
        uri: 'file:///cache/encoded-0.7.jpg',
        contentType: 'image/jpeg',
        width: 512,
        height: 512,
        bytes: 200 * KB,
        quality: 0.7,
      },
    });
    expect(JSON.stringify(out)).not.toContain('original.jpg');
  });

  it('passes a cancelled or denied pick through and encodes nothing', async () => {
    const cancelled = modules({ kind: 'cancelled' }, () => 0);
    expect(await preparePhoto(cancelled, 'library')).toEqual({ kind: 'cancelled' });
    const denied = modules({ kind: 'denied' }, () => 0);
    expect(await preparePhoto(denied, 'library')).toEqual({ kind: 'denied' });
    expect(cancelled.encodeJpeg).not.toHaveBeenCalled();
    expect(denied.encodeJpeg).not.toHaveBeenCalled();
  });

  it('refuses a type other than JPEG or PNG before encoding (R1.7)', async () => {
    const m = modules({ kind: 'picked', image: { ...picked, mimeType: 'image/gif' } }, () => 0);
    expect(await preparePhoto(m, 'library')).toEqual({ kind: 'unsupported' });
    expect(m.encodeJpeg).not.toHaveBeenCalled();
  });

  it('answers too_large when even the last quality is over 300 KB', async () => {
    const m = modules({ kind: 'picked', image: picked }, () => 400 * KB);
    expect(await preparePhoto(m, 'library')).toEqual({ kind: 'too_large' });
    expect(m.encodeJpeg).toHaveBeenCalledTimes(3);
  });
});
