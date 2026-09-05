import { describe, expect, it } from 'vitest';
import {
  characterVisualProfileEnvelopeSchema,
  characterVisualProfilePayloadSchema,
  locationVisualProfilePayloadSchema,
  characterAppearanceStagePayloadSchema,
  locationHardGeometrySchema,
  referenceBindingsSchema,
  sceneTransientEnvironmentSchema,
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

  it('separates appearance stages, hard Location data, and ordered references', () => {
    expect(
      characterAppearanceStagePayloadSchema.parse({
        clothing: ['winter coat'],
        equipment: ['medical bag'],
      }),
    ).toEqual({
      clothing: ['winter coat'],
      accessories: [],
      equipment: ['medical bag'],
    });
    expect(() =>
      characterAppearanceStagePayloadSchema.parse({
        clothing: [],
        emotion: 'angry',
      }),
    ).toThrow();
    expect(() =>
      referenceBindingsSchema.parse([
        {
          ordinal: 1,
          role: 'CHARACTER',
          assetId: 'asset-a',
          entityId: 'character-a',
          stageId: null,
          sha256: 'a'.repeat(64),
          revision: 1,
          fingerprint: 'binding-a',
        },
        {
          ordinal: 1,
          role: 'LOCATION',
          assetId: 'asset-b',
          entityId: 'location-a',
          stageId: null,
          sha256: 'b'.repeat(64),
          revision: 1,
          fingerprint: 'binding-b',
        },
      ]),
    ).toThrow();
    expect(locationHardGeometrySchema.parse({ architecture: 'stone house' })).not.toHaveProperty(
      'weather',
    );
    expect(sceneTransientEnvironmentSchema.parse({ weather: 'rain' })).not.toHaveProperty(
      'architecture',
    );
  });
});
