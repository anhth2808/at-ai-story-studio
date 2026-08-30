import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabase, WorkflowRepository } from './index.js';

function setup() {
  return mkdtemp(join(tmpdir(), 'studio-db-')).then((root) => {
    const database = createDatabase(join(root, 'studio.db'));
    database.sqlite.exec(
      readFileSync(join(process.cwd(), 'packages/database/migrations/0000_initial.sql'), 'utf8'),
    );
    database.sqlite.exec(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Test','vi-VN','{}','2026-01-01','2026-01-01')",
    );
    return database;
  });
}

describe('workflow repository', () => {
  it('claims one step and does not duplicate a completed step', async () => {
    const database = await setup();
    const repo = new WorkflowRepository(database);
    const execution = repo.createExecution('project', 'TEST');
    const stepId = repo.createStep(execution, 'test', 'TEST', 'entity', 'fingerprint');
    repo.createJob('TEST', 'entity', stepId);
    const claim = repo.claim('worker-a');
    expect(claim?.id).toBe(stepId);
    expect(repo.claim('worker-b')).toBeNull();
    repo.complete(claim!);
    expect(repo.claim('worker-b')).toBeNull();
    database.sqlite.close();
  });
  it('recovers an expired running step', async () => {
    const database = await setup();
    const repo = new WorkflowRepository(database);
    const execution = repo.createExecution('project', 'TEST');
    const stepId = repo.createStep(execution, 'test', 'TEST', 'entity', 'fingerprint');
    repo.createJob('TEST', 'entity', stepId);
    const claim = repo.claim('worker-a', 1);
    expect(claim).not.toBeNull();
    database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), stepId);
    expect(repo.recoverExpired()).toBe(1);
    expect(repo.getStep(stepId)?.status).toBe('PENDING');
    database.sqlite.close();
  });
  it('keeps recovered work safe from the stale worker', async () => {
    const database = await setup();
    const repo = new WorkflowRepository(database);
    const execution = repo.createExecution('project', 'TEST');
    const completedId = repo.createStep(execution, 'completed', 'TEST', 'entity', 'one');
    const recoveredId = repo.createStep(execution, 'recovered', 'TEST', 'entity', 'two');
    const completedJobId = repo.createJob('TEST', 'entity', completedId);
    const recoveredJobId = repo.createJob('TEST', 'entity', recoveredId);
    const first = repo.claim('worker-a')!;
    repo.complete(first);
    const stale = repo.claim('worker-a', 1)!;
    database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), recoveredId);
    repo.recoverExpired();
    repo.complete(stale);
    const recovered = repo.claim('worker-b')!;
    expect(recovered.id).toBe(recoveredId);
    repo.complete(recovered);
    expect(repo.getStep(completedId)?.status).toBe('COMPLETED');
    expect(repo.getStep(completedId)?.attempts).toBe(1);
    expect(repo.getStep(recoveredId)?.status).toBe('COMPLETED');
    expect(repo.getJob(completedJobId)?.status).toBe('COMPLETED');
    expect(repo.getStep(recoveredId)?.attempts).toBe(2);
    expect(repo.getJob(recoveredJobId)?.status).toBe('COMPLETED');
    database.sqlite.close();
  });
});
