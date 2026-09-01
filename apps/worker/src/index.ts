import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  migrateDatabase,
  HeartbeatRepository,
  StoryBatchRepository,
  WorkflowRepository,
} from '@studio/database';
import { FfmpegTools, ProcessRunner, reconcileWorkspace, initializeWorkspace } from '@studio/media';
import {
  ImageProviderError,
  WorkerExecutor,
  createImageGenerationService,
  createOmpAgent,
  createStoryEngine,
  createVisualConsistencyService,
  SceneEngine,
} from '@studio/workflow';
const root =
  process.env.STUDIO_WORKSPACE ??
  join(dirname(fileURLToPath(import.meta.url)), '../../../workspace');
const database = createDatabase(process.env.STUDIO_DB_PATH ?? join(root, 'studio.db'));
try {
  migrateDatabase(database);
} catch (error) {
  console.error('Database migration failed', error);
  process.exit(1);
}
const workspace = await initializeWorkspace(root);
await reconcileWorkspace(workspace);
const runner = new ProcessRunner();
const context = { database, workspace, runner, media: new FfmpegTools(runner) };
const workerId = `worker-${randomUUID()}`;
const workflow = new WorkflowRepository(database);
const agent = createOmpAgent(runner);
const storyEngine = createStoryEngine({ database, agent });
const sceneEngine = new SceneEngine({ database, agent });
const batches = new StoryBatchRepository(database);
const heartbeat = new HeartbeatRepository(database);
const visualService = createVisualConsistencyService(database, agent);
const imageService = createImageGenerationService(context);
const executor = new WorkerExecutor(
  context,
  workerId,
  undefined,
  storyEngine,
  sceneEngine,
  visualService,
  imageService,
);
let stopping = false;
let activeController: AbortController | undefined;
const stop = (): void => {
  stopping = true;
  activeController?.abort();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const heartbeatTimer = setInterval(() => heartbeat.beat(workerId, 'READY'), 5_000);

while (!stopping) {
  heartbeat.beat(workerId, 'READY');
  workflow.recoverExpired();
  batches.reconcileRecoveredSteps();
  const step = workflow.claim(workerId);
  if (!step) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  batches.markRunning(step.id);
  const controller = new AbortController();
  activeController = controller;
  const cancellationPoll = setInterval(() => {
    if (workflow.isCancellationRequested(step.id)) controller.abort();
  }, 250);
  const stepHeartbeat = setInterval(() => workflow.heartbeat(step), 5_000);
  try {
    await executor.execute(step, controller.signal);
    clearInterval(cancellationPoll);
    if (controller.signal.aborted || workflow.isCancellationRequested(step.id)) {
      workflow.cancel(step);
      batches.reconcileWorkflowStep(step.id);
    } else {
      workflow.complete(step);
      batches.reconcileWorkflowStep(step.id);
    }
  } catch (error) {
    clearInterval(cancellationPoll);
    if (controller.signal.aborted || workflow.isCancellationRequested(step.id)) {
      workflow.cancel(step, 'Cancelled by user');
      batches.reconcileWorkflowStep(step.id);
    } else {
      const retry = error instanceof ImageProviderError ? error.retryable : true;
      workflow.fail(step, error instanceof Error ? error.message : 'Worker step failed', retry);
      batches.reconcileWorkflowStep(step.id);
    }
  } finally {
    clearInterval(cancellationPoll);
    clearInterval(stepHeartbeat);
    activeController = undefined;
  }
}
clearInterval(heartbeatTimer);
heartbeat.beat(workerId, 'STOPPED');
database.sqlite.close();
