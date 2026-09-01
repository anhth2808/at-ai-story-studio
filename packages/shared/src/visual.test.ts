import { describe, expect, it } from 'vitest';
import {
  characterVisualProfileEnvelopeSchema,
  characterVisualProfilePayloadSchema,
  locationVisualProfilePayloadSchema,
  visualObjectProfilePayloadSchema,
} from './visual.js';

describe('visual contracts', () => {
  it('applies bounded defaults to valid profile candidates', () => {
    expect(
      characterVisualProfileEnvelopeSchema.parse({ profile: { hairColor: 'black' } }),
    ).toMatchObject({
      profile: { hairColor: 'black', distinctiveFeatures: [], variants: [], referenceAssetIds: [] },
    });
    expect(
      locationVisualProfilePayloadSchema.parse({ overallDescription: 'old courtyard' }),
    ).toMatchObject({
      overallDescription: 'old courtyard',
      importantLandmarks: [],
    });
    expect(visualObjectProfilePayloadSchema.parse({ name: 'lantern' })).toMatchObject({
      name: 'lantern',
      materials: [],
      referenceAssetIds: [],
    });
  });

  it('rejects unknown and oversized provider fields', () => {
    expect(() =>
      characterVisualProfilePayloadSchema.parse({ unknownProviderField: 'x' }),
    ).toThrow();
    expect(() =>
      characterVisualProfilePayloadSchema.parse({ hairColor: 'x'.repeat(241) }),
    ).toThrow();
    expect(() =>
      characterVisualProfileEnvelopeSchema.parse({ profile: {}, extra: true }),
    ).toThrow();
  });
});
