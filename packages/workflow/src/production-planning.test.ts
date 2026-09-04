import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@studio/database';
import type { DatabaseHandle } from '@studio/database';
import type { FfmpegTools } from '@studio/media';
import type { RenderPlan } from '@studio/shared';
import { ProductionPlanner, ProductionPreflightService } from './production-planning.js';

const projectId = '11111111-1111-4111-8111-111111111111';

function setup(chapterCount = 2): DatabaseHandle {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const stamp = '2026-01-01T00:00:00.000Z';
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Planning test', 'vi-VN', '{}', stamp, stamp);
  for (let number = 1; number <= chapterCount; number += 1) {
    database.sqlite
      .prepare(
        'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
        projectId,
        number,
        `Chapter ${number}`,
        `Text ${number}`,
        'ACTIVE',
        1,
        1,
        stamp,
        stamp,
      );
  }
  return database;
}

function context(database: DatabaseHandle) {
  return {
    database,
    workspace: {
      root: tmpdir(),
      database: join(tmpdir(), 'studio.db'),
      projects: tmpdir(),
      staging: tmpdir(),
    },
    media: {
      health: async () => ({ ffmpeg: true, ffprobe: true, message: 'ready' }),
    } as unknown as FfmpegTools,
  };
}

describe('production preflight and planning', () => {
  it('treats unavailable optional AI video as a warning only with fallback', async () => {
    const database = setup();
    const readyWithoutFallback = new ProductionPreflightService(context(database), {
      aiVideo: async () => ({ ready: false, message: 'AI video unavailable' }),
    });
    const profile = readyWithoutFallback.profiles.getOrCreate(projectId, 'BALANCED');
    const fallback = await readyWithoutFallback.check(
      projectId,
      { type: 'FULL_PROJECT' },
      profile.id,
    );
    expect(fallback.issues.find((item) => item.code === 'AI_VIDEO_FALLBACK')?.severity).toBe(
      'WARNING',
    );
    const strictProfile = readyWithoutFallback.profiles.update(projectId, 'BALANCED', {
      expectedRowVersion: profile.rowVersion,
      settings: { allowKenBurnsFallback: false },
    });
    const blocked = await readyWithoutFallback.check(
      projectId,
      { type: 'FULL_PROJECT' },
      strictProfile.id,
    );
    expect(blocked.issues.find((item) => item.code === 'AI_VIDEO_REQUIRED')?.severity).toBe(
      'BLOCKING',
    );
    database.sqlite.close();
  });
  it('is read-only and names continuity blockers', async () => {
    const database = setup();
    const planning = new ProductionPreflightService(context(database));
    const first = await planning.check(projectId, { type: 'FULL_PROJECT' });
    const second = await planning.check(projectId, { type: 'FULL_PROJECT' });
    expect(first.status).toBe('READY_WITH_WARNINGS');
    expect(first.issues.map((item) => item.code)).toEqual(second.issues.map((item) => item.code));
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM production_runs').get()).toEqual({
      count: 0,
    });
    expect(
      database.sqlite.prepare('SELECT COUNT(*) as count FROM workflow_executions').get(),
    ).toEqual({ count: 0 });
    database.sqlite
      .prepare(
        "UPDATE chapters SET continuity_status='CONTINUITY_STALE' WHERE project_id=? AND number=1",
      )
      .run(projectId);
    const blocked = await planning.check(projectId, { type: 'FULL_PROJECT' });
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.issues.find((item) => item.code === 'CONTINUITY_BLOCKER')?.severity).toBe(
      'BLOCKING',
    );
    database.sqlite.close();
  });

  it('keeps plans fingerprint-stable and bounds chapter units without prose', async () => {
    const database = setup(200);
    const preflight = new ProductionPreflightService(context(database));
    const planner = new ProductionPlanner(context(database), { preflight });
    const first = await planner.plan(projectId, { type: 'FULL_PROJECT' });
    const second = await planner.plan(projectId, { type: 'FULL_PROJECT' });
    expect(first.fingerprint).toBe(second.fingerprint);
    const chapters = first.stages.find((stage) => stage.key === 'CHAPTERS')!;
    expect(chapters.progress.total).toBe(200);
    expect(chapters.units).toHaveLength(100);
    expect(chapters.units[0]).not.toHaveProperty('content');
    expect(first.stages).toHaveLength(11);
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM workflow_steps').get()).toEqual({
      count: 0,
    });
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM jobs').get()).toEqual({
      count: 0,
    });
    database.sqlite.close();
  });
  it('uses a valid render fallback policy when Ken Burns is enabled', async () => {
    const database = setup();
    const preflight = new ProductionPreflightService(context(database));
    let receivedFallback: string | undefined;
    const planner = new ProductionPlanner(context(database), {
      preflight,
      timeline: {
        getRenderPlan: (_projectId, request) => {
          receivedFallback = request.fallbackPolicy;
          return {
            projectId,
            scope: { kind: 'FULL_STORY' },
            source: 'SCENES',
            autoBuild: false,
            fallbackPolicy: 'FAIL',
            scenes: { total: 0, reusable: 0, required: 0, blocked: 0 },
            chapters: { total: 0, reusable: 0, required: 0, blocked: 0 },
            project: { required: false, reusable: true, fingerprint: null },
            ai: null,
            expectedDurationMs: null,
            blockers: [],
            generatedAt: new Date().toISOString(),
          } satisfies RenderPlan;
        },
      },
    });
    await planner.plan(projectId, { type: 'FULL_PROJECT' });
    expect(receivedFallback).toBe('FAIL');
    database.sqlite.close();
  });
});
