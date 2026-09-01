import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OMP_MODEL,
  ompProtocolErrorSchema,
  ompProtocolRequestSchema,
  ompProtocolResultSchema,
  parseOmpProtocolLine,
  storySettingsSchema,
} from './story.js';

const request = {
  kind: 'request' as const,
  version: 1 as const,
  correlationId: '11111111-1111-4111-8111-111111111111',
  operation: 'BLUEPRINT' as const,
  model: 'openai-codex/gpt-5.6-luna',
  promptVersion: 'story.blueprint.v1',
  schemaVersion: 'story.v1',
  inputFingerprint: 'a'.repeat(64),
  systemPrompt: 'Return JSON.',
  userPrompt: 'Story data.',
  deadlineMs: 60_000,
};

describe('Story Engine schemas', () => {
  it('normalizes valid settings and rejects adaptation mode', () => {
    const settings = storySettingsSchema.parse({
      idea: 'A lighthouse keeper finds a message from the future.',
      genre: 'mystery',
      tone: 'quiet and hopeful',
      audience: 'general',
      targetChapterCount: 3,
      chapterLength: 800,
      pacing: 'MEDIUM',
    });
    expect(settings.mode).toBe('IDEA_TO_STORY');
    expect(settings.generation.model).toBe(DEFAULT_OMP_MODEL);
    expect(() => storySettingsSchema.parse({ ...settings, mode: 'ADAPTATION' })).toThrow();
    expect(() => storySettingsSchema.parse({ ...settings, targetChapterCount: 201 })).toThrow();
  });

  it('validates protocol requests and terminal events', () => {
    expect(ompProtocolRequestSchema.parse(request)).toEqual(request);
    expect(
      parseOmpProtocolLine(
        JSON.stringify({
          kind: 'result',
          version: 1,
          correlationId: request.correlationId,
          operation: 'BLUEPRINT',
          text: '{"ok":true}',
          provider: 'openai-codex',
          model: 'gpt-5.6-luna',
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          durationMs: 1,
        }),
      ),
    ).toMatchObject({ kind: 'result', operation: 'BLUEPRINT' });
  });

  it('rejects malformed, oversized, and duplicate-terminal-shaped payloads', () => {
    expect(() => ompProtocolRequestSchema.parse({ ...request, version: 2 })).toThrow();
    expect(() =>
      ompProtocolRequestSchema.parse({ ...request, correlationId: 'not-an-id' }),
    ).toThrow();
    expect(() => parseOmpProtocolLine(JSON.stringify({ ...request, kind: 'result' }))).toThrow();
    expect(() => parseOmpProtocolLine('{"kind":"result"}')).toThrow();
    expect(() =>
      ompProtocolResultSchema.parse({
        kind: 'result',
        version: 1,
        correlationId: request.correlationId,
        operation: 'BLUEPRINT',
        text: 'x'.repeat(2_000_001),
        provider: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        durationMs: 1,
      }),
    ).toThrow();
    expect(
      ompProtocolErrorSchema.parse({
        kind: 'error',
        version: 1,
        correlationId: request.correlationId,
        code: 'PROTOCOL_ERROR',
        message: 'duplicate terminal event',
        retryable: false,
      }).code,
    ).toBe('PROTOCOL_ERROR');
  });
});
