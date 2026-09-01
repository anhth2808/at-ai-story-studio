import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  ChapterRepository,
  SceneRepository,
  StoryRepository,
} from '@studio/database';
import { AppError } from '@studio/shared';
import { SCENE_CONTEXT_MAX_CHARS, buildSceneGenerationContext } from './scene-context.js';
import { renderScenePlanningPrompt } from './story-prompts.js';

function setup(content: string) {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Context','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,story_origin,created_at,updated_at) VALUES('chapter','project',1,'Chapter',?,'ACTIVE',1,1,'MANUAL','2026-01-01','2026-01-01')",
    )
    .run(content);
  return {
    database,
    story: new StoryRepository(database),
    chapters: new ChapterRepository(database),
    scenes: new SceneRepository(database),
  };
}

describe('Scene Engine context compiler', () => {
  it('preserves exact chapter text and records bounded context diagnostics', () => {
    const content = 'Dòng đầu có emoji 😀.\nDòng sau không được sửa.';
    const fixture = setup(content);
    const context = buildSceneGenerationContext({
      ...fixture,
      projectId: 'project',
      chapterId: 'chapter',
      density: 'MEDIUM',
      targetRange: null,
      style: null,
    });
    expect(context.chapter.text).toBe(content);
    expect(context.selectedContext).toContain('chapter:text');
    expect(context.omittedContext).toEqual(
      expect.arrayContaining([
        { id: 'story:blueprint', reason: 'NOT_AVAILABLE' },
        { id: 'chapter:plan-item', reason: 'NOT_AVAILABLE' },
        { id: 'visual-style:current', reason: 'NOT_AVAILABLE' },
      ]),
    );
    fixture.database.sqlite.close();
  });

  it('publishes the exact versioned nested scene contract', () => {
    const fixture = setup('A courier crosses the old bridge.');
    const context = buildSceneGenerationContext({
      ...fixture,
      projectId: 'project',
      chapterId: 'chapter',
      density: 'MEDIUM',
      targetRange: null,
      style: null,
    });
    const prompt = renderScenePlanningPrompt(context);
    expect(prompt.promptVersion).toBe('scene-planning-v4');
    expect(prompt.schemaVersion).toBe('scene-planning-v4');
    expect(prompt.systemPrompt).toContain('camera exactly');
    expect(prompt.systemPrompt).toContain('subjectFocus string');
    expect(prompt.systemPrompt).toContain('WIDE_SHOT');
    fixture.database.sqlite.close();
  });

  it('fails explicitly instead of truncating an oversized chapter', () => {
    const fixture = setup('x'.repeat(SCENE_CONTEXT_MAX_CHARS + 1));
    expect(() =>
      buildSceneGenerationContext({
        ...fixture,
        projectId: 'project',
        chapterId: 'chapter',
        density: 'LOW',
        targetRange: null,
        style: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'SCENE_CONTEXT_TOO_LARGE',
      } satisfies Partial<AppError>),
    );
    fixture.database.sqlite.close();
  });
});
