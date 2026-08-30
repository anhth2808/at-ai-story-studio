import { createHash } from 'node:crypto';
import type { ChapterPlanItem, ChapterSummary, StoryBlueprint, StoryThread } from '@studio/shared';

export type SummaryContextItem = {
  chapterNumber: number;
  revision: number;
  summary: ChapterSummary;
};

export type GenerationContextInput = {
  blueprint: StoryBlueprint | null;
  selectedCharacterIds?: string[];
  planItem?: ChapterPlanItem | null;
  priorSummaries?: SummaryContextItem[];
  relevantFacts?: string[];
  openThreads?: StoryThread[];
  instructions?: string[];
  missingContext?: string[];
  budget?: number;
};

export type BoundedGenerationContext = {
  budget: number;
  estimatedTokens: number;
  sections: Array<{ name: string; content: string }>;
  omittedContext: string[];
  inputFingerprint: string;
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableValue(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function boundedContent(
  value: unknown,
  maxTokens: number,
): { content: string; truncated: boolean } {
  const serialized = stableValue(value);
  const maxChars = Math.max(0, maxTokens * 4);
  if (serialized.length <= maxChars) return { content: serialized, truncated: false };
  if (maxChars < 16) return { content: '', truncated: true };
  return { content: `${serialized.slice(0, maxChars - 15)}...[truncated]`, truncated: true };
}

function selectedCharacters(blueprint: StoryBlueprint | null, ids: string[]): unknown[] {
  if (!blueprint) return [];
  const selected = new Set(ids);
  return blueprint.characters
    .filter((character) => selected.size === 0 || selected.has(character.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function compileGenerationContext(input: GenerationContextInput): BoundedGenerationContext {
  const budget = input.budget ?? 5_000;
  if (!Number.isInteger(budget) || budget < 500 || budget > 10_000)
    throw new Error('Generation context budget must be between 500 and 10000 tokens');
  const omittedContext: string[] = [
    ...new Set((input.missingContext ?? []).map((item) => `missing:${item}`)),
  ];
  const sections: Array<{ name: string; content: string }> = [];
  let remaining = budget;
  const add = (name: string, value: unknown, required = false): void => {
    if (remaining <= 0) {
      omittedContext.push(name);
      return;
    }
    const bounded = boundedContent(value, remaining);
    if (!bounded.content && !required) {
      omittedContext.push(name);
      return;
    }
    sections.push({ name, content: bounded.content });
    remaining = Math.max(0, remaining - estimateTokens(bounded.content));
    if (bounded.truncated) omittedContext.push(`${name}:truncated`);
  };

  const blueprint = input.blueprint
    ? {
        premise: input.blueprint.premise,
        themes: [...input.blueprint.themes].sort(),
        worldRules: [...input.blueprint.worldRules].sort(),
        continuityConstraints: [...input.blueprint.continuityConstraints].sort(),
        plotDirection: input.blueprint.plotDirection,
      }
    : null;
  add('blueprint', blueprint, true);
  add(
    'selected-characters',
    selectedCharacters(input.blueprint, [...(input.selectedCharacterIds ?? [])]),
  );
  add('plan-item', input.planItem ?? null, Boolean(input.planItem));
  add(
    'open-threads',
    [...(input.openThreads ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
  );
  add(
    'prior-summaries',
    [...(input.priorSummaries ?? [])].sort(
      (left, right) => left.chapterNumber - right.chapterNumber,
    ),
  );
  add('relevant-facts', [...(input.relevantFacts ?? [])].sort());
  add('instructions', [...(input.instructions ?? [])]);

  const withoutFingerprint = { budget, sections, omittedContext };
  return {
    ...withoutFingerprint,
    estimatedTokens: sections.reduce(
      (total, section) => total + estimateTokens(section.content),
      0,
    ),
    inputFingerprint: createHash('sha256').update(stableValue(withoutFingerprint)).digest('hex'),
  };
}
