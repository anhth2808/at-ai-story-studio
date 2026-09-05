import {
  futureCharacterResolutionSchema,
  type FutureCharacterEvidenceSource,
  type FutureCharacterResolution,
  type StoryBlueprint,
} from '@studio/shared';

type FutureIdentityContextItem = {
  source: Exclude<FutureCharacterEvidenceSource, 'BLUEPRINT_ALIAS'>;
  reference: string;
  text: string;
  characterIds?: string[];
};

type FutureIdentityReference = {
  voiceId?: string | null;
  referenceAssetIds?: string[];
};

export type FutureCharacterIdentityInput = {
  alias: string;
  blueprint: StoryBlueprint | null;
  context?: FutureIdentityContextItem[];
  references?: Record<string, FutureIdentityReference>;
};

const MAX_CONTEXT_ITEMS = 12;
const MAX_CONTEXT_TEXT = 4_000;
const REVEAL_MARKER =
  /\b(?:real name|revealed as|actually|also known as|is|was)\b|(?:tên thật|chính là|hóa ra|lộ diện là)/iu;

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function mentions(text: string, value: string): boolean {
  const normalizedText = normalize(text);
  const normalizedValue = normalize(value);
  return normalizedValue.length > 0 && normalizedText.includes(normalizedValue);
}

function evidenceExcerpt(alias: string, text: string): string {
  const compact = text.trim().replace(/\s+/gu, ' ');
  if (compact.length <= 1_000) return compact;
  const index = normalize(compact).indexOf(normalize(alias));
  const start = Math.max(0, Math.min(index < 0 ? 0 : index - 300, compact.length - 1_000));
  return compact.slice(start, start + 1_000);
}

function resolved(
  alias: string,
  characterId: string,
  confidence: number,
  evidence: FutureCharacterResolution['evidence'],
  references: Record<string, FutureIdentityReference>,
  blueprint: StoryBlueprint,
): FutureCharacterResolution {
  const character = blueprint.characters.find((candidate) => candidate.id === characterId);
  const reference = references[characterId];
  return futureCharacterResolutionSchema.parse({
    alias,
    characterId,
    voiceId: reference?.voiceId ?? character?.voiceId ?? null,
    referenceAssetIds: [...new Set(reference?.referenceAssetIds ?? [])].slice(0, 12),
    evidence: evidence.slice(0, 12),
    confidence,
    status: 'RESOLVED',
  });
}

function unresolved(
  alias: string,
  status: 'AMBIGUOUS' | 'UNRESOLVED',
  evidence: FutureCharacterResolution['evidence'],
): FutureCharacterResolution {
  return futureCharacterResolutionSchema.parse({
    alias,
    characterId: null,
    voiceId: null,
    referenceAssetIds: [],
    evidence: evidence.slice(0, 12),
    confidence: 0,
    status,
  });
}

export function resolveFutureCharacterIdentity(
  input: FutureCharacterIdentityInput,
): FutureCharacterResolution {
  const alias = input.alias.trim();
  const blueprint = input.blueprint;
  if (!blueprint) return unresolved(alias, 'UNRESOLVED', []);
  const references = input.references ?? {};
  const direct = blueprint.characters.filter(
    (character) =>
      normalize(character.name) === normalize(alias) ||
      (character.aliases ?? []).some((candidate) => normalize(candidate) === normalize(alias)),
  );
  if (direct.length === 1) {
    return resolved(
      alias,
      direct[0]!.id,
      1,
      [
        {
          source: 'BLUEPRINT_ALIAS',
          reference: `blueprint:${blueprint.characters.find((candidate) => candidate.id === direct[0]!.id)?.id ?? direct[0]!.id}`,
          excerpt: `The blueprint declares ${alias} as ${direct[0]!.name}.`,
        },
      ],
      references,
      blueprint,
    );
  }
  if (direct.length > 1)
    return unresolved(
      alias,
      'AMBIGUOUS',
      direct.map((character) => ({
        source: 'BLUEPRINT_ALIAS' as const,
        reference: `blueprint:${character.id}`,
        excerpt: `The alias ${alias} matches ${character.name}.`,
      })),
    );

  const matches = new Map<
    string,
    { confidence: number; evidence: FutureCharacterResolution['evidence'] }
  >();
  for (const item of (input.context ?? []).slice(0, MAX_CONTEXT_ITEMS)) {
    const text = item.text.trim().slice(0, MAX_CONTEXT_TEXT);
    if (!text || !mentions(text, alias)) continue;
    for (const character of blueprint.characters) {
      const named =
        mentions(text, character.name) ||
        (character.aliases ?? []).some((value) => mentions(text, value));
      const listed = item.characterIds?.includes(character.id) ?? false;
      if ((!named && !listed) || (!listed && !REVEAL_MARKER.test(text))) continue;
      const entry = matches.get(character.id) ?? { confidence: 0, evidence: [] };
      entry.confidence = Math.max(
        entry.confidence,
        item.source === 'PLAN_WINDOW' ? 0.95 : item.source === 'CHAPTER_SUMMARY' ? 0.9 : 0.85,
      );
      if (!entry.evidence.some((value) => value.reference === item.reference))
        entry.evidence.push({
          source: item.source,
          reference: item.reference,
          excerpt: evidenceExcerpt(alias, text),
        });
      matches.set(character.id, entry);
    }
  }
  if (matches.size === 1) {
    const [characterId, match] = [...matches.entries()][0]!;
    return resolved(alias, characterId, match.confidence, match.evidence, references, blueprint);
  }
  if (matches.size > 1)
    return unresolved(
      alias,
      'AMBIGUOUS',
      [...matches.values()].flatMap((match) => match.evidence),
    );
  return unresolved(alias, 'UNRESOLVED', []);
}

export type { FutureIdentityContextItem, FutureIdentityReference };
