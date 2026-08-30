import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDatabase, HeartbeatRepository, WorkflowRepository } from '@studio/database';
import { FfmpegTools, ProcessRunner, cleanupOldStaging, initializeWorkspace } from '@studio/media';
import { WorkerExecutor } from '@studio/workflow';
const root =
  process.env.STUDIO_WORKSPACE ??
  join(dirname(fileURLToPath(import.meta.url)), '../../../workspace');
const database = createDatabase(process.env.STUDIO_DB_PATH ?? join(root, 'studio.db'));
try {
  database.sqlite.exec(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../packages/database/migrations/0000_initial.sql',
      ),
      'utf8',
    ),
  );
} catch (error) {
  console.error('Database migration failed', error);
  process.exit(1);
}
const workspace = await initializeWorkspace(root);
await cleanupOldStaging(workspace.staging);
const runner = new ProcessRunner();
const context = { database, workspace, runner, media: new FfmpegTools(runner) };
const workerId = `worker-${randomUUID()}`;
const heartbeat = new HeartbeatRepository(database);
const workflow = new WorkflowRepository(database);
const executor = new WorkerExecutor(context, workerId);
let stopping = false;
const stop = (): void => {
  stopping = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

while (!stopping) {
  heartbeat.beat(workerId, 'READY');
  workflow.recoverExpired();
  const step = workflow.claim(workerId);
  if (!step) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  try {
    await executor.execute(step);
    workflow.complete(step);
  } catch (error) {
    workflow.fail(step, error instanceof Error ? error.message : 'Worker step failed', true);
  }
}
heartbeat.beat(workerId, 'STOPPED');
database.sqlite.close();
