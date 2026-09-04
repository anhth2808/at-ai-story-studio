import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AssetRepository,
  ProductionProfileRepository,
  ProductionRunRepository,
  PublicationExportRepository,
  PublicationPackageRepository,
  WorkflowRepository,
  productionFingerprint,
  type ClaimedStep,
  type DatabaseHandle,
  type ProductionRunRecord,
} from '@studio/database';
import { z } from 'zod';
import { safeWorkspacePath, sha256File } from '@studio/media';
import {
  AppError,
  idSchema,
  publicationExportRequestSchema,
  publicationMetadataSchema,
  publicationMetadataUpdateSchema,
  publicationManifestSchema,
  publicationValidationIssueSchema,
  type Id,
  type PublicationChapterMarker,
  type PublicationMetadata,
  type PublicationPackageDto,
  type PublicationPackageStatus,
} from '@studio/shared';
import { projectVideoRole } from './timeline-workflow.js';
import type { StudioContext } from './index.js';

const now = (): string => new Date().toISOString();
const packageWorkflowType = 'PUBLICATION_PACKAGE';
const packageStepTypes = ['GENERATE_PUBLICATION_METADATA', 'BUILD_PUBLICATION_PACKAGE'] as const;
const publicationStepPayloadSchema = z.object({ runId: idSchema, projectId: idSchema }).strict();
const publicationExportStepPayloadSchema = z
  .object({ packageId: idSchema, directoryName: z.string() })
  .strict();

type AssetRow = {
  id: Id;
  path: string;
  type: string;
  sha256: string;
  mediaType: string;
  bytes: number;
  metadata: string | null;
};

type PackageSchedule = { executionId: Id; stepIds: Id[]; jobIds: Id[] };

function jsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function assetDuration(database: DatabaseHandle, assetId: Id | null): number | null {
  if (!assetId) return null;
  const row = database.sqlite.prepare('SELECT metadata FROM assets WHERE id=?').get(assetId) as
    { metadata: string | null } | undefined;
  const duration = jsonObject(row?.metadata ?? null).durationMs;
  return typeof duration === 'number' && Number.isInteger(duration) && duration > 0
    ? duration
    : null;
}

export class PublicationPackageService {
  readonly packages: PublicationPackageRepository;
  readonly exports: PublicationExportRepository;
  readonly runs: ProductionRunRepository;
  readonly profiles: ProductionProfileRepository;
  readonly assets: AssetRepository;
  readonly workflow: WorkflowRepository;

  constructor(private readonly context: StudioContext) {
    this.packages = new PublicationPackageRepository(context.database);
    this.exports = new PublicationExportRepository(context.database);
    this.profiles = new ProductionProfileRepository(context.database);
    this.runs = new ProductionRunRepository(context.database, this.profiles);
    this.assets = new AssetRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
  }

  private project(projectId: Id): { id: Id; title: string; description: string; language: string } {
    const row = this.context.database.sqlite
      .prepare('SELECT id,title,description,language FROM projects WHERE id=?')
      .get(projectId) as
      { id: Id; title: string; description: string; language: string } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return row;
  }

  private metadata(projectId: Id, existing: PublicationMetadata | null): PublicationMetadata {
    if (existing) return publicationMetadataSchema.parse(existing);
    const project = this.project(projectId);
    const description =
      project.description.trim().length >= 5
        ? project.description.trim()
        : `Produced story: ${project.title}`;
    return publicationMetadataSchema.parse({
      title: project.title,
      description,
      shortDescription: description.slice(0, 500),
      tags: [],
      contentWarning: null,
      language: project.language,
    });
  }

  private chapters(run: ProductionRunRecord): Array<{
    id: Id;
    number: number;
    title: string;
  }> {
    const filters = ['project_id=?', "status='ACTIVE'"];
    const parameters: Array<string | number> = [run.projectId];
    if (run.scope.type === 'CHAPTER_RANGE') {
      filters.push('number BETWEEN ? AND ?');
      parameters.push(run.scope.startChapter, run.scope.endChapter);
    }
    return this.context.database.sqlite
      .prepare(
        `SELECT id,number,title FROM chapters WHERE ${filters.join(' AND ')} ORDER BY number LIMIT 500`,
      )
      .all(...parameters) as Array<{ id: Id; number: number; title: string }>;
  }

  private currentAsset(projectId: Id, role: string): AssetRow | null {
    return this.context.database.sqlite
      .prepare(
        `SELECT id,path,type,sha256,media_type as mediaType,bytes,metadata FROM assets
         WHERE project_id=? AND role=? AND status='READY' AND is_current=1 ORDER BY created_at DESC LIMIT 1`,
      )
      .get(projectId, role) as AssetRow | null;
  }

  private thumbnail(projectId: Id): AssetRow | null {
    return (
      this.currentAsset(projectId, 'project:thumbnail') ??
      (this.context.database.sqlite
        .prepare(
          `SELECT id,path,type,sha256,media_type as mediaType,bytes,metadata FROM assets
           WHERE project_id=? AND type='PUBLICATION_THUMBNAIL' AND status='READY' AND is_current=1
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(projectId) as AssetRow | null)
    );
  }

  private activeBuildSteps(
    runId: Id,
  ): Array<{ stepId: Id; type: string; inputFingerprint: string }> {
    return this.context.database.sqlite
      .prepare(
        `SELECT id as stepId,type,input_fingerprint as inputFingerprint FROM workflow_steps
         WHERE entity_id=? AND type IN (?,?) AND status IN ('PENDING','RUNNING') ORDER BY created_at LIMIT 10`,
      )
      .all(runId, ...packageStepTypes) as Array<{
      stepId: Id;
      type: string;
      inputFingerprint: string;
    }>;
  }

  scheduleBuild(runId: Id): PackageSchedule {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    const active = this.activeBuildSteps(runId);
    if (active.length) {
      return {
        executionId: run.workflowExecutionId,
        stepIds: active.map((step) => step.stepId),
        jobIds: active
          .map(
            (step) =>
              this.context.database.sqlite
                .prepare('SELECT id FROM jobs WHERE step_id=?')
                .get(step.stepId) as { id: Id } | undefined,
          )
          .filter((job): job is { id: Id } => Boolean(job))
          .map((job) => job.id),
      };
    }
    const executionId = this.workflow.createExecution(run.projectId, packageWorkflowType);
    const metadataStep = this.workflow.createStep(
      executionId,
      `publication-metadata:${run.id}:${run.profileRevision}`,
      'GENERATE_PUBLICATION_METADATA',
      run.id,
      productionFingerprint({
        operation: 'PUBLICATION_METADATA',
        runId,
        profileRevision: run.profileRevision,
      }),
      3,
      { runId, projectId: run.projectId },
    );
    const packageStep = this.workflow.createStep(
      executionId,
      `publication-package:${run.id}:${run.fingerprint}`,
      'BUILD_PUBLICATION_PACKAGE',
      run.id,
      productionFingerprint({
        operation: 'PUBLICATION_PACKAGE',
        runId,
        runFingerprint: run.fingerprint,
      }),
      3,
      { runId, projectId: run.projectId },
    );
    this.workflow.dependency(packageStep, metadataStep);
    return {
      executionId,
      stepIds: [metadataStep, packageStep],
      jobIds: [
        this.workflow.createJob('GENERATE_PUBLICATION_METADATA', run.id, metadataStep),
        this.workflow.createJob('BUILD_PUBLICATION_PACKAGE', run.id, packageStep),
      ],
    };
  }

  generateMetadata(runId: Id): PublicationPackageDto {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    const existing = this.packages.getByRun(runId);
    if (existing?.metadata) return existing;
    const project = this.project(run.projectId);
    const metadata = this.metadata(project.id, existing?.metadata ?? null);
    const fingerprint = productionFingerprint({
      operation: 'PUBLICATION_METADATA',
      runId,
      metadata,
    });
    return this.packages.createRevision({
      projectId: project.id,
      runId,
      status: existing?.status ?? 'INCOMPLETE',
      fingerprint,
      videoAssetId: existing?.video?.assetId ?? null,
      thumbnailAssetId: existing?.thumbnail?.assetId ?? null,
      subtitleAssetIds: existing?.subtitles.map((subtitle) => subtitle.assetId) ?? [],
      metadata,
      chapterMarkers: existing?.chapterMarkers ?? [],
      validation: existing?.validation ?? [],
      manifest: null,
    });
  }

  async build(runId: Id): Promise<PublicationPackageDto> {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    const project = this.project(run.projectId);
    const existing = this.packages.getByRun(runId);
    const metadata = this.metadata(project.id, existing?.metadata ?? null);
    const video = this.currentAsset(
      project.id,
      projectVideoRole(project.id, this.renderScope(run)),
    );
    const chapters = this.chapters(run);
    const subtitleAssets = chapters.map((chapter) =>
      this.currentAsset(project.id, `chapter:${chapter.id}:subtitle`),
    );
    const thumbnail = this.thumbnail(project.id);
    const settings = this.profiles.get(run.profileId)?.settings;
    const validation = [];
    if (!video)
      validation.push(
        publicationValidationIssueSchema.parse({
          code: 'VIDEO_REQUIRED',
          severity: 'BLOCKING',
          message: 'A current rendered video is required',
          action: 'Complete the Render stage',
        }),
      );
    else {
      try {
        const probe = await this.context.media.probe(
          safeWorkspacePath(this.context.workspace.root, video.path),
        );
        const streams: unknown[] = Array.isArray(probe.streams) ? probe.streams : [];
        const format =
          probe.format && typeof probe.format === 'object' && !Array.isArray(probe.format)
            ? (probe.format as Record<string, unknown>)
            : {};
        const duration = Number(format.duration);
        const validVideo = streams.some(
          (stream) =>
            stream &&
            typeof stream === 'object' &&
            'codec_type' in stream &&
            stream.codec_type === 'video',
        );
        if (!validVideo || !Number.isFinite(duration) || duration <= 0)
          throw new Error('invalid video');
      } catch {
        validation.push(
          publicationValidationIssueSchema.parse({
            code: 'RENDER_OUTPUT_INVALID',
            severity: 'BLOCKING',
            message: 'The current rendered video failed ffprobe validation',
            action: 'Re-run the Render stage and verify the output media',
          }),
        );
      }
    }
    const blockingIntervention = this.context.database.sqlite
      .prepare(
        "SELECT 1 FROM production_interventions WHERE run_id=? AND status='OPEN' AND severity='BLOCKING' LIMIT 1",
      )
      .get(runId);
    if (blockingIntervention)
      validation.push(
        publicationValidationIssueSchema.parse({
          code: 'BLOCKING_INTERVENTION_OPEN',
          severity: 'BLOCKING',
          message: 'A blocking production intervention is still open',
          action: 'Resolve all blocking production interventions before publishing',
        }),
      );
    const missingSubtitles = subtitleAssets.filter((asset) => !asset).length;
    if (missingSubtitles)
      validation.push(
        publicationValidationIssueSchema.parse({
          code: 'SUBTITLES_REQUIRED',
          severity: 'BLOCKING',
          message: `${missingSubtitles} chapter subtitles are missing`,
          action: 'Complete the Subtitle stage',
        }),
      );
    if (!thumbnail && settings?.requireThumbnail)
      validation.push(
        publicationValidationIssueSchema.parse({
          code: 'THUMBNAIL_REQUIRED',
          severity: 'BLOCKING',
          message: 'A publication thumbnail is required',
          action: 'Upload or select a thumbnail',
        }),
      );
    else if (!thumbnail)
      validation.push(
        publicationValidationIssueSchema.parse({
          code: 'THUMBNAIL_MISSING',
          severity: 'WARNING',
          message: 'No publication thumbnail was selected',
          action: 'Select a thumbnail before publishing',
        }),
      );
    const chapterMarkers: PublicationChapterMarker[] = [];
    let offsetMs = 0;
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]!;
      const audio = this.currentAsset(project.id, `chapter:${chapter.id}:audio`);
      const durationMs = assetDuration(this.context.database, audio?.id ?? null);
      chapterMarkers.push({
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        title: chapter.title,
        offsetMs,
      });
      if (durationMs === null) {
        validation.push(
          publicationValidationIssueSchema.parse({
            code: 'AUDIO_DURATION_UNKNOWN',
            severity: 'BLOCKING',
            message: `Measured audio duration is missing for chapter ${chapter.number}`,
            action: 'Complete narration and persist a measured duration before publishing',
          }),
        );
      } else {
        offsetMs += durationMs;
      }
    }
    const status: PublicationPackageStatus = validation.some((item) => item.severity === 'BLOCKING')
      ? 'INCOMPLETE'
      : 'READY';
    const fingerprint = productionFingerprint({
      operation: 'PUBLICATION_PACKAGE',
      runId,
      video: video?.id ?? null,
      subtitles: subtitleAssets.map((asset) => asset?.id ?? null),
      thumbnail: thumbnail?.id ?? null,
      metadata,
      chapterMarkers,
    });
    if (
      status === 'READY' &&
      existing?.status === 'READY' &&
      existing.fingerprint === fingerprint &&
      existing.manifest
    )
      return existing;
    const first = this.packages.createRevision({
      projectId: project.id,
      runId,
      status,
      fingerprint,
      videoAssetId: video?.id ?? null,
      thumbnailAssetId: thumbnail?.id ?? null,
      subtitleAssetIds: subtitleAssets
        .filter((asset): asset is AssetRow => Boolean(asset))
        .map((asset) => asset.id),
      metadata,
      chapterMarkers,
      validation,
      manifest: null,
    });
    if (status !== 'READY' || !first.video) return first;
    const manifest = publicationManifestSchema.parse({
      format: 'ai-story-studio-publication',
      formatVersion: 1,
      projectId: project.id,
      runId,
      packageId: first.id,
      packageRevision: first.revision + 1,
      packageFingerprint: fingerprint,
      scope: {
        type: run.scope.type,
        startChapter: run.scope.type === 'CHAPTER_RANGE' ? run.scope.startChapter : null,
        endChapter: run.scope.type === 'CHAPTER_RANGE' ? run.scope.endChapter : null,
      },
      video: first.video,
      subtitles: first.subtitles,
      thumbnail: first.thumbnail,
      metadata,
      chapterMarkers,
      validation,
      metrics: { chapterCount: chapters.length, reused: false },
      generatedAt: now(),
    });
    return this.packages.createRevision({
      projectId: project.id,
      runId,
      status: 'READY',
      fingerprint,
      videoAssetId: first.video.assetId,
      thumbnailAssetId: thumbnail?.id ?? null,
      subtitleAssetIds: subtitleAssets
        .filter((asset): asset is AssetRow => Boolean(asset))
        .map((asset) => asset.id),
      metadata,
      chapterMarkers,
      validation,
      manifest,
    });
  }

  updateMetadata(packageId: Id, value: unknown): PublicationPackageDto {
    const input = publicationMetadataUpdateSchema.parse(value);
    const current = this.packages.get(packageId);
    if (!current) throw new AppError('PACKAGE_NOT_FOUND', 'Publication package not found', 404);
    const { expectedRevision, ...patch } = input;
    if (expectedRevision !== undefined && expectedRevision !== current.revision)
      throw new AppError(
        'PACKAGE_VERSION_CONFLICT',
        'Publication package changed; reload before updating',
        409,
      );
    const metadata = publicationMetadataSchema.parse({
      ...(current.metadata ?? this.metadata(current.projectId, null)),
      ...patch,
    });
    const expectedRowVersion = this.packages.getRowVersion(packageId);
    return this.packages.createRevision({
      projectId: current.projectId,
      runId: current.runId,
      status: 'STALE',
      fingerprint: productionFingerprint({
        operation: 'PUBLICATION_METADATA_UPDATE',
        packageId,
        metadata,
      }),
      videoAssetId: current.video?.assetId ?? null,
      thumbnailAssetId: current.thumbnail?.assetId ?? null,
      subtitleAssetIds: current.subtitles.map((subtitle) => subtitle.assetId),
      metadata,
      chapterMarkers: current.chapterMarkers,
      validation: current.validation,
      manifest: null,
      expectedRowVersion,
    });
  }

  selectThumbnail(packageId: Id, assetId: Id, expectedRevision?: number): PublicationPackageDto {
    const current = this.packages.get(packageId);
    if (!current) throw new AppError('PACKAGE_NOT_FOUND', 'Publication package not found', 404);
    if (expectedRevision !== undefined && expectedRevision !== current.revision)
      throw new AppError(
        'PACKAGE_VERSION_CONFLICT',
        'Publication package changed; reload before updating',
        409,
      );
    return this.packages.selectThumbnail(
      packageId,
      assetId,
      this.packages.getRowVersion(packageId),
    );
  }

  scheduleExport(packageId: Id, directoryName: string): { exportId: Id; stepId: Id; jobId: Id } {
    const safeDirectoryName = publicationExportRequestSchema.parse({ directoryName }).directoryName;
    const packageRecord = this.packages.get(packageId);
    if (!packageRecord?.manifest || packageRecord.status !== 'READY')
      throw new AppError(
        'PACKAGE_NOT_READY',
        'A ready publication package is required before export',
        409,
      );
    const executionId = this.workflow.createExecution(
      packageRecord.projectId,
      'PUBLICATION_EXPORT',
    );
    const stepId = this.workflow.createStep(
      executionId,
      `publication-export:${packageId}:${safeDirectoryName}`,
      'EXPORT_PUBLICATION_PACKAGE',
      packageId,
      productionFingerprint({
        operation: 'PUBLICATION_EXPORT',
        packageId,
        directoryName: safeDirectoryName,
        revision: packageRecord.revision,
      }),
      3,
      { packageId, directoryName: safeDirectoryName },
    );
    const exportId = randomUUID();
    this.exports.create(packageId, safeDirectoryName, stepId, exportId);
    return {
      exportId,
      stepId,
      jobId: this.workflow.createJob('EXPORT_PUBLICATION_PACKAGE', packageId, stepId),
    };
  }

  async executeExport(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = publicationExportStepPayloadSchema.parse(JSON.parse(step.payload || '{}'));
    const request = publicationExportRequestSchema.parse({ directoryName: payload.directoryName });
    const packageRecord = this.packages.get(payload.packageId);
    if (!packageRecord?.manifest || packageRecord.status !== 'READY')
      throw new AppError('PACKAGE_NOT_READY', 'Publication package is no longer ready', 409);
    const exportRow = this.context.database.sqlite
      .prepare('SELECT id FROM publication_exports WHERE package_id=? AND workflow_step_id=?')
      .get(payload.packageId, step.id) as { id: Id } | undefined;
    if (!exportRow)
      throw new AppError('EXPORT_NOT_FOUND', 'Publication export record not found', 404);
    const targetRelative = `exports/${request.directoryName}`;
    const target = safeWorkspacePath(this.context.workspace.root, targetRelative);
    await this.exports.setStatus(exportRow.id, 'RUNNING');
    try {
      await mkdir(dirname(target), { recursive: true });
      await mkdir(target, { recursive: false });
      const references = [
        { prefix: 'video', asset: packageRecord.manifest.video },
        ...packageRecord.manifest.subtitles.map((asset, index) => ({
          prefix: `subtitle-${index + 1}`,
          asset,
        })),
        ...(packageRecord.manifest.thumbnail
          ? [{ prefix: 'thumbnail', asset: packageRecord.manifest.thumbnail }]
          : []),
      ];
      for (const reference of references) {
        if (signal?.aborted)
          throw new AppError('CANCELLED', 'Publication export was cancelled', 409);
        const source = this.context.database.sqlite
          .prepare("SELECT path FROM assets WHERE id=? AND project_id=? AND status='READY'")
          .get(reference.asset.assetId, packageRecord.projectId) as { path: string } | undefined;
        if (!source)
          throw new AppError('ASSET_NOT_FOUND', 'A publication asset is no longer available', 409);
        const sourcePath = safeWorkspacePath(this.context.workspace.root, source.path);
        const destination = join(target, `${reference.prefix}-${reference.asset.exportName}`);
        const partial = `${destination}.partial`;
        await copyFile(sourcePath, partial);
        await rename(partial, destination);
        const digest = await sha256File(destination);
        if (digest.hash !== reference.asset.sha256)
          throw new AppError(
            'EXPORT_CHECKSUM_MISMATCH',
            `Exported ${reference.prefix} failed checksum verification`,
            409,
          );
      }
      const manifestPath = join(target, 'publication.json');
      await writeFile(
        `${manifestPath}.partial`,
        `${JSON.stringify(packageRecord.manifest, null, 2)}\n`,
        'utf8',
      );
      await rename(`${manifestPath}.partial`, manifestPath);
      await this.exports.setStatus(exportRow.id, 'COMPLETED', packageRecord.manifest);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      const safe = {
        code: error instanceof AppError ? error.code : 'EXPORT_FAILED',
        message: error instanceof Error ? error.message.slice(0, 500) : 'Publication export failed',
      };
      await this.exports.setStatus(exportRow.id, 'FAILED', null, safe);
      throw error;
    }
  }

  private renderScope(run: ProductionRunRecord) {
    return run.scope.type === 'FULL_PROJECT'
      ? ({ kind: 'FULL_STORY' } as const)
      : ({
          kind: 'CHAPTER_RANGE',
          startChapterNumber: run.scope.startChapter,
          endChapterNumber: run.scope.endChapter,
        } as const);
  }

  async executeMetadataStep(step: ClaimedStep): Promise<void> {
    const payload = publicationStepPayloadSchema.parse(JSON.parse(step.payload || '{}'));
    this.generateMetadata(payload.runId);
  }

  async executePackageStep(step: ClaimedStep): Promise<void> {
    const payload = publicationStepPayloadSchema.parse(JSON.parse(step.payload || '{}'));
    await this.build(payload.runId);
  }
}
