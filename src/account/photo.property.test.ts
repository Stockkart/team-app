// Task 14.8 — Property 25, phone half (Photo rules; R1.7): for any quality ladder and any byte
// size each quality encodes to, `shrinkToLimit` answers the first quality in the ladder whose
// output is at most the limit, or the last quality when none fits; it encodes each quality once,
// in ladder order, and never a quality after the one that fits. Through `preparePhoto` with the
// real ladder (0.85 → 0.7 → 0.55) and the real limit (300 KB), a photo is handed to the upload
// iff some rung fits, it is always ≤ 300 KB, always resized to 512, and never the original.
//
// The rung the ladder stops at is written out here independently of `shrinkToLimit` (a plain
// `findIndex` over the sizes), so the implementation cannot vouch for itself. Sizes are drawn
// around the limit so "fits at the first rung", "fits further down" and "never fits" are all
// common, and the ladder is not assumed to be monotone: the rule is "first rung that fits", not
// "smallest output".
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIDE,
  PHOTO_QUALITIES,
  preparePhoto,
  shrinkToLimit,
  type EncodedImage,
  type PhotoModules,
  type PickedImage,
} from './photo';

const NUM_RUNS = 300;
const KB = 1024;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

/** A byte limit: the real one most of the time, otherwise anything from 0 to about 1 MB. */
const limit = fc.oneof(
  { weight: 3, arbitrary: fc.constant(MAX_PHOTO_BYTES) },
  { weight: 1, arbitrary: fc.nat({ max: 1024 * KB }) },
);

/**
 * How many bytes one rung encodes to, given the limit: clustered just under, exactly at and just
 * over the limit (the boundary `≤` has to be exact), with some far-off sizes mixed in.
 */
function bytesNear(lim: number): fc.Arbitrary<number> {
  return fc.oneof(
    { weight: 2, arbitrary: fc.integer({ min: Math.max(0, lim - 64), max: lim }) },
    { weight: 2, arbitrary: fc.integer({ min: lim + 1, max: lim + 65 }) },
    { weight: 1, arbitrary: fc.nat({ max: 4 * lim + 1 }) },
  );
}

/** A JPEG quality in (0, 1]. Distinct within one ladder so a rung can be looked up by quality. */
const quality = fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true });

/** A ladder of one to six distinct qualities (any order: the rule is positional, not by value). */
const ladder = fc.uniqueArray(quality, { minLength: 1, maxLength: 6 });

/** A limit, a ladder and the byte size each rung encodes to, by position. */
const scenario = limit.chain((lim) =>
  ladder.chain((qualities) =>
    fc
      .array(bytesNear(lim), { minLength: qualities.length, maxLength: qualities.length })
      .map((sizes) => ({ limit: lim, qualities, sizes })),
  ),
);

/** For the real ladder: the byte size each of the three rungs encodes to, around 300 KB. */
const realSizes = fc.array(bytesNear(MAX_PHOTO_BYTES), {
  minLength: PHOTO_QUALITIES.length,
  maxLength: PHOTO_QUALITIES.length,
});

/** A square crop from the picker: any side the phone might hand over, JPEG, PNG or unknown. */
const pickedImage: fc.Arbitrary<PickedImage> = fc
  .record({
    side: fc.integer({ min: 1, max: 6000 }),
    mimeType: fc.constantFrom('image/jpeg', 'image/png', 'IMAGE/JPEG', 'image/PNG', undefined),
  })
  .map(({ side, mimeType }) => ({
    uri: 'file:///cache/original-from-picker.img',
    width: side,
    height: side,
    ...(mimeType === undefined ? {} : { mimeType }),
  }));

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

/** The ladder rule written out plainly: the first rung that fits, else the last rung. */
function referenceStop(sizes: readonly number[], lim: number): number {
  const first = sizes.findIndex((bytes) => bytes <= lim);
  return first === -1 ? sizes.length - 1 : first;
}

/** An encoder scripted by position in the ladder that records every call. */
function scriptedEncoder(qualities: readonly number[], sizes: readonly number[]) {
  const calls: number[] = [];
  const encodeAt = (q: number) => {
    calls.push(q);
    const index = qualities.indexOf(q);
    if (index === -1) {
      throw new Error(`encodeAt called with a quality not in the ladder: ${q}`);
    }
    return { bytes: sizes[index], tag: `encoding-${index}` };
  };
  return { encodeAt, calls };
}

// ---------------------------------------------------------------------------------------------
// shrinkToLimit
// ---------------------------------------------------------------------------------------------

describe('Property 25 (phone half): shrinkToLimit', () => {
  it('answers the first rung whose output fits, else the last rung (sync encoder)', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ limit: lim, qualities, sizes }) => {
        const { encodeAt } = scriptedEncoder(qualities, sizes);
        const out = await shrinkToLimit(encodeAt, qualities, lim);
        const stop = referenceStop(sizes, lim);
        expect(out.quality).toBe(qualities[stop]);
        expect(out.result).toEqual({ bytes: sizes[stop], tag: `encoding-${stop}` });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('answers the same rung when the encoder is asynchronous', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ limit: lim, qualities, sizes }) => {
        const sync = scriptedEncoder(qualities, sizes);
        const async = scriptedEncoder(qualities, sizes);
        const fromSync = await shrinkToLimit(sync.encodeAt, qualities, lim);
        const fromAsync = await shrinkToLimit(
          async (q: number) => Promise.resolve(async.encodeAt(q)),
          qualities,
          lim,
        );
        expect(fromAsync).toEqual(fromSync);
        expect(async.calls).toEqual(sync.calls);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('encodes each rung once, in ladder order, up to and including the answer, and no further', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ limit: lim, qualities, sizes }) => {
        const { encodeAt, calls } = scriptedEncoder(qualities, sizes);
        await shrinkToLimit(encodeAt, qualities, lim);
        const stop = referenceStop(sizes, lim);
        expect(calls).toEqual(qualities.slice(0, stop + 1));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('answers an output within the limit iff some rung of the ladder fits', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ limit: lim, qualities, sizes }) => {
        const { encodeAt } = scriptedEncoder(qualities, sizes);
        const out = await shrinkToLimit(encodeAt, qualities, lim);
        const someRungFits = sizes.some((bytes) => bytes <= lim);
        expect(out.result.bytes <= lim).toBe(someRungFits);
        // Every rung before the answer was over the limit: nothing fitting was skipped.
        const stop = qualities.indexOf(out.quality);
        expect(sizes.slice(0, stop).every((bytes) => bytes > lim)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('uses the real ladder and the real limit by default', async () => {
    await fc.assert(
      fc.asyncProperty(realSizes, async (sizes) => {
        const { encodeAt, calls } = scriptedEncoder(PHOTO_QUALITIES, sizes);
        const out = await shrinkToLimit(encodeAt);
        const stop = referenceStop(sizes, MAX_PHOTO_BYTES);
        expect(out.quality).toBe(PHOTO_QUALITIES[stop]);
        expect(calls).toEqual(PHOTO_QUALITIES.slice(0, stop + 1));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('refuses an empty ladder whatever the limit, without encoding', async () => {
    await fc.assert(
      fc.asyncProperty(limit, async (lim) => {
        let encoded = 0;
        await expect(
          shrinkToLimit(
            () => {
              encoded += 1;
              return { bytes: 0 };
            },
            [],
            lim,
          ),
        ).rejects.toThrow(/empty/);
        expect(encoded).toBe(0);
      }),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// preparePhoto: the ladder in place, with the real limit and the real side (R1.7)
// ---------------------------------------------------------------------------------------------

/** Scripted picker and manipulator: the pick succeeds, each rung encodes to `sizes[rung]`. */
function scriptedModules(image: PickedImage, sizes: readonly number[]) {
  const encodeCalls: Array<{ uri: string; maxSide: number; quality: number }> = [];
  const modules: PhotoModules = {
    picker: { pick: async () => ({ kind: 'picked', image }) },
    manipulator: {
      async encodeJpeg(picked, maxSide, q): Promise<EncodedImage> {
        encodeCalls.push({ uri: picked.uri, maxSide, quality: q });
        const index = PHOTO_QUALITIES.indexOf(q);
        if (index === -1) {
          throw new Error(`encodeJpeg called with a quality not in the ladder: ${q}`);
        }
        const side = Math.min(maxSide, picked.width);
        return {
          uri: `file:///cache/encoded-${index}.jpg`,
          width: side,
          height: side,
          bytes: sizes[index],
        };
      },
    },
  };
  return { modules, encodeCalls };
}

describe('Property 25 (phone half): preparePhoto with the real ladder and limit', () => {
  it('uploads a JPEG ≤ 300 KB at the first fitting rung, or refuses as too_large', async () => {
    await fc.assert(
      fc.asyncProperty(
        pickedImage,
        realSizes,
        fc.constantFrom('camera' as const, 'library' as const),
        async (image, sizes, source) => {
          const { modules, encodeCalls } = scriptedModules(image, sizes);
          const out = await preparePhoto(modules, source);
          const stop = referenceStop(sizes, MAX_PHOTO_BYTES);
          const someRungFits = sizes.some((bytes) => bytes <= MAX_PHOTO_BYTES);

          // Every encoding is of the picked crop, to the server's side, down the ladder in order.
          expect(encodeCalls).toEqual(
            PHOTO_QUALITIES.slice(0, stop + 1).map((q) => ({
              uri: image.uri,
              maxSide: MAX_PHOTO_SIDE,
              quality: q,
            })),
          );

          if (!someRungFits) {
            expect(out).toEqual({ kind: 'too_large' });
            return;
          }
          expect(out.kind).toBe('photo');
          if (out.kind !== 'photo') {
            return;
          }
          expect(out.photo.contentType).toBe('image/jpeg');
          expect(out.photo.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
          expect(out.photo.bytes).toBe(sizes[stop]);
          expect(out.photo.quality).toBe(PHOTO_QUALITIES[stop]);
          expect(out.photo.width).toBeLessThanOrEqual(MAX_PHOTO_SIDE);
          expect(out.photo.height).toBeLessThanOrEqual(MAX_PHOTO_SIDE);
          // The encoded file goes up, never the picker's original.
          expect(out.photo.uri).toBe(`file:///cache/encoded-${stop}.jpg`);
          expect(JSON.stringify(out)).not.toContain(image.uri);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
