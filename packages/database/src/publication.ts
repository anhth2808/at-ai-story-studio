import { randomUUID } from 'node:crypto';
import {
  AppError,
  publicationManifestSchema,
  publicationMetadataSchema,
  publicationPackageStatusSchema,
  type Id,
  type PublicationAssetReference,
  type PublicationChapterMarker,
  type PublicationExportDto,
  type PublicationManifest,
  type PublicationMetadata,
  type PublicationPackageDto,
  type PublicationPackageStatus,
  type PublicationValidationIssue,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';
import { productionFingerprint } from './production.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);

function parsedJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function recordJson(value: string | null | undefined): Record<string, unknown> | null {
  const parsed: unknown = parsedJson(value, null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function assetExportName(path: string, assetId: Id): string {
  const candidate = path.split(/[\\/]/u).at(-1) ?? '';
  return /^[A-Za-z0-9._-]+$/u.test(candidate) && candidate.length > 0 ? candidate : assetId;
}

function assetReference(
  database: DatabaseHandle,
  projectId: Id,
  assetId: Id | null,
): PublicationAssetReference | null {
  if (!assetId) return null;
  const row = database.sqlite
    .prepare(
      `SELECT id,sha256,media_type as mediaType,bytes,path,metadata
       FROM assets WHERE id=? AND project_id=? AND status='READY'`,
    )
    .get(assetId, projectId) as
    | {
        id: Id;
        sha256: string;
        mediaType: string;
        bytes: number;
        path: string;
        metadata: string;
      }
    | undefined;
  if (!row) return null;
  const metadata = recordJson(row.metadata);
  const duration = metadata?.durationMs;
  return {
    assetId: row.id,
    sha256: row.sha256,
    mediaType: row.mediaType,
    bytes: row.bytes,
    durationMs:
      typeof duration === 'number' && Number.isInteger(duration) && duration >= 0 ? duration : null,
    exportName: assetExportName(row.path, row.id),
    url: `/api/assets/${row.id}`,
  };
}
function assetReferences(
  database: DatabaseHandle,
  projectId: Id,
  assetIds: string | null | undefined,
): PublicationAssetReference[] {
  const ids = parsedJson<unknown>(assetIds, []);
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((value): value is Id => typeof value === 'string')
    .map((assetId) => assetReference(database, projectId, assetId))
    .filter((value): value is PublicationAssetReference => value !== null);
}

export type PublicationPackageRecord = PublicationPackageDto;
export type CreatePublicationPackageRevisionInput = {
  projectId: Id;
  runId: Id;
  status: PublicationPackageStatus;
  fingerprint: string;
  videoAssetId: Id | null;
  thumbnailAssetId: Id | null;
  subtitleAssetIds: Id[];
  metadata: PublicationMetadata | null;
  chapterMarkers: PublicationChapterMarker[];
  validation: PublicationValidationIssue[];
  manifest: PublicationManifest | null;
  expectedRowVersion?: number;
};

export class PublicationPackageRepository {
  constructor(private readonly database: DatabaseHandle) {}

  private read(row: Record<string, unknown> | undefined): PublicationPackageRecord | null {
    if (!row) return null;
    const status = publicationPackageStatusSchema.parse(row.status);
    const metadata = row.metadata
      ? (publicationMetadataSchema.safeParse(parsedJson(row.metadata as string, null)).data ?? null)
      : null;
    const manifest = row.manifest
      ? (publicationManifestSchema.safeParse(parsedJson(row.manifest as string, null)).data ?? null)
      : null;
    return {
      id: row.id as Id,
      projectId: row.projectId as Id,
      runId: row.runId as Id,
      revision: Number(row.revision),
      status,
      fingerprint: String(row.fingerprint),
      video: assetReference(
        this.database,
        row.projectId as Id,
        (row.videoAssetId as Id | null) ?? null,
      ),
      subtitles: assetReferences(
        this.database,
        row.projectId as Id,
        row.subtitleAssetIds as string | null,
      ),
      thumbnail: assetReference(
        this.database,
        row.projectId as Id,
        (row.thumbnailAssetId as Id | null) ?? null,
      ),
      metadata,
      chapterMarkers: parsedJson(row.chapterMarkers as string, []) as PublicationChapterMarker[],
      validation: parsedJson(row.validation as string, []) as PublicationValidationIssue[],
      manifest,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  private selectRow(id: Id): Record<string, unknown> | undefined {
    return this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,run_id as runId,revision,status,fingerprint,
          video_asset_id as videoAssetId,thumbnail_asset_id as thumbnailAssetId,subtitle_asset_ids as subtitleAssetIds,
          metadata,chapter_markers as chapterMarkers,validation,manifest,created_at as createdAt,updated_at as updatedAt
         FROM publication_packages WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
  }

  get(id: Id): PublicationPackageRecord | null {
    return this.read(this.selectRow(id));
  }

  getByRun(runId: Id): PublicationPackageRecord | null {
    const row = this.database.sqlite
      .prepare('SELECT id FROM publication_packages WHERE run_id=?')
      .get(runId) as { id: Id } | undefined;
    return row ? this.get(row.id) : null;
  }

  getRowVersion(packageId: Id): number {
    const row = this.database.sqlite
      .prepare('SELECT row_version as rowVersion FROM publication_packages WHERE id=?')
      .get(packageId) as { rowVersion: number } | undefined;
    if (!row) throw new AppError('PACKAGE_NOT_FOUND', 'Publication package not found', 404);
    return Number(row.rowVersion);
  }

  list(projectId: Id, limit = 50): PublicationPackageRecord[] {
    return this.database.sqlite
      .prepare(
        'SELECT id FROM publication_packages WHERE project_id=? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(projectId, Math.max(1, Math.min(100, limit)))
      .map((row) => this.get((row as { id: Id }).id)!)
      .filter(Boolean);
  }

  createRevision(input: CreatePublicationPackageRevisionInput): PublicationPackageRecord {
    publicationPackageStatusSchema.parse(input.status);
    if (input.manifest) publicationManifestSchema.parse(input.manifest);
    if (input.metadata) publicationMetadataSchema.parse(input.metadata);
    const tx = this.database.sqlite.transaction(() => {
      const current = this.database.sqlite
        .prepare(
          'SELECT id,revision,row_version as rowVersion FROM publication_packages WHERE project_id=? AND run_id=?',
        )
        .get(input.projectId, input.runId) as
        { id: Id; revision: number; rowVersion: number } | undefined;
      const stamp = now();
      if (!current) {
        const packageId = randomUUID();
        const revisionId = randomUUID();
        this.database.sqlite
          .prepare(
            `INSERT INTO publication_packages(
              id,project_id,run_id,revision,status,fingerprint,video_asset_id,thumbnail_asset_id,subtitle_asset_ids,metadata,
              chapter_markers,validation,manifest,row_version,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          )
          .run(
            packageId,
            input.projectId,
            input.runId,
            1,
            input.status,
            input.fingerprint,
            input.videoAssetId,
            input.thumbnailAssetId,
            json(input.subtitleAssetIds.slice(0, 500)),
            input.metadata ? json(input.metadata) : null,
            json(input.chapterMarkers.slice(0, 500)),
            json(input.validation.slice(0, 200)),
            input.manifest ? json(input.manifest) : null,
            stamp,
            stamp,
          );
        this.database.sqlite
          .prepare(
            `INSERT INTO publication_package_revisions(
              id,package_id,revision,status,fingerprint,video_asset_id,thumbnail_asset_id,subtitle_asset_ids,metadata,
              chapter_markers,validation,manifest,is_current,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
          )
          .run(
            revisionId,
            packageId,
            1,
            input.status,
            input.fingerprint,
            input.videoAssetId,
            input.thumbnailAssetId,
            json(input.subtitleAssetIds.slice(0, 500)),
            input.metadata ? json(input.metadata) : null,
            json(input.chapterMarkers.slice(0, 500)),
            json(input.validation.slice(0, 200)),
            input.manifest ? json(input.manifest) : null,
            stamp,
          );
        return packageId;
      }
      if (input.expectedRowVersion !== undefined && input.expectedRowVersion !== current.rowVersion)
        throw new AppError(
          'PACKAGE_VERSION_CONFLICT',
          'Publication package changed; reload before updating',
          409,
        );
      const nextRevision = current.revision + 1;
      this.database.sqlite
        .prepare(
          'UPDATE publication_package_revisions SET is_current=0 WHERE package_id=? AND is_current=1',
        )
        .run(current.id);
      this.database.sqlite
        .prepare(
          `INSERT INTO publication_package_revisions(
            id,package_id,revision,status,fingerprint,video_asset_id,thumbnail_asset_id,subtitle_asset_ids,metadata,
            chapter_markers,validation,manifest,is_current,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        )
        .run(
          randomUUID(),
          current.id,
          nextRevision,
          input.status,
          input.fingerprint,
          input.videoAssetId,
          input.thumbnailAssetId,
          json(input.subtitleAssetIds.slice(0, 500)),
          input.metadata ? json(input.metadata) : null,
          json(input.chapterMarkers.slice(0, 500)),
          json(input.validation.slice(0, 200)),
          input.manifest ? json(input.manifest) : null,
          stamp,
        );
      const updated = this.database.sqlite
        .prepare(
          `UPDATE publication_packages SET revision=?,status=?,fingerprint=?,video_asset_id=?,thumbnail_asset_id=?,subtitle_asset_ids=?,metadata=?,
            chapter_markers=?,validation=?,manifest=?,row_version=row_version+1,updated_at=?
           WHERE id=? AND row_version=?`,
        )
        .run(
          nextRevision,
          input.status,
          input.fingerprint,
          input.videoAssetId,
          input.thumbnailAssetId,
          json(input.subtitleAssetIds.slice(0, 500)),
          input.metadata ? json(input.metadata) : null,
          json(input.chapterMarkers.slice(0, 500)),
          json(input.validation.slice(0, 200)),
          input.manifest ? json(input.manifest) : null,
          stamp,
          current.id,
          current.rowVersion,
        );
      if (updated.changes !== 1)
        throw new AppError(
          'PACKAGE_VERSION_CONFLICT',
          'Publication package changed; reload before updating',
          409,
        );
      return current.id;
    });
    const packageId = tx();
    const packageRecord = this.get(packageId);
    if (!packageRecord)
      throw new AppError('PACKAGE_NOT_FOUND', 'Publication package was not persisted', 500);
    return packageRecord;
  }

  selectThumbnail(
    packageId: Id,
    thumbnailAssetId: Id,
    expectedRowVersion?: number,
  ): PublicationPackageRecord {
    const current = this.get(packageId);
    if (!current) throw new AppError('PACKAGE_NOT_FOUND', 'Publication package not found', 404);
    const asset = this.database.sqlite
      .prepare(
        `SELECT id FROM assets
         WHERE id=? AND project_id=? AND status='READY' AND is_current=1
           AND type IN ('PUBLICATION_THUMBNAIL','SCENE_IMAGE','BACKGROUND_IMAGE')`,
      )
      .get(thumbnailAssetId, current.projectId) as { id: Id } | undefined;
    if (!asset) throw new AppError('ASSET_NOT_FOUND', 'Publication thumbnail asset not found', 404);
    return this.createRevision({
      projectId: current.projectId,
      runId: current.runId,
      status: current.status === 'READY' ? 'STALE' : current.status,
      fingerprint: productionFingerprint({ package: current.fingerprint, thumbnailAssetId }),
      videoAssetId: current.video?.assetId ?? null,
      thumbnailAssetId,
      subtitleAssetIds: current.subtitles.map((subtitle) => subtitle.assetId),
      metadata: current.metadata,
      chapterMarkers: current.chapterMarkers,
      validation: current.validation,
      manifest: null,
      expectedRowVersion,
    });
  }

  listRevisions(packageId: Id, limit = 100): Array<Record<string, unknown>> {
    return this.database.sqlite
      .prepare(
        `SELECT id,package_id as packageId,revision,status,fingerprint,video_asset_id as videoAssetId,
          thumbnail_asset_id as thumbnailAssetId,subtitle_asset_ids as subtitleAssetIds,metadata,
          chapter_markers as chapterMarkers,validation,manifest,is_current as isCurrent,created_at as createdAt
         FROM publication_package_revisions WHERE package_id=? ORDER BY revision DESC LIMIT ?`,
      )
      .all(packageId, Math.max(1, Math.min(100, limit)))
      .map((row) => {
        const value = row as Record<string, unknown>;
        return {
          ...value,
          metadata: value.metadata ? recordJson(value.metadata as string) : null,
          chapterMarkers: parsedJson(value.chapterMarkers as string, []),
          validation: parsedJson(value.validation as string, []),
          manifest: value.manifest ? parsedJson(value.manifest as string, null) : null,
          isCurrent: Boolean(value.isCurrent),
        };
      });
  }

  markStaleByRun(runId: Id): void {
    this.database.sqlite
      .prepare(
        "UPDATE publication_packages SET status='STALE',row_version=row_version+1,updated_at=? WHERE run_id=? AND status='READY'",
      )
      .run(now(), runId);
  }
}

export class PublicationExportRepository {
  constructor(private readonly database: DatabaseHandle) {}

  private read(row: Record<string, unknown> | undefined): PublicationExportDto | null {
    if (!row) return null;
    return {
      id: row.id as Id,
      packageId: row.packageId as Id,
      status: row.status as PublicationExportDto['status'],
      directoryName: String(row.directoryName),
      manifest: row.manifest
        ? (parsedJson(row.manifest as string, null) as PublicationManifest | null)
        : null,
      error: row.error
        ? (recordJson(row.error as string) as { code: string; message: string } | null)
        : null,
    };
  }

  get(id: Id): PublicationExportDto | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,package_id as packageId,status,directory_name as directoryName,manifest,error
         FROM publication_exports WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return this.read(row);
  }

  list(packageId: Id, limit = 50): PublicationExportDto[] {
    return this.database.sqlite
      .prepare(
        `SELECT id,package_id as packageId,status,directory_name as directoryName,manifest,error
         FROM publication_exports WHERE package_id=? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(packageId, Math.max(1, Math.min(100, limit)))
      .map((row) => this.read(row as Record<string, unknown>)!)
      .filter(Boolean);
  }

  create(packageId: Id, directoryName: string, workflowStepId?: Id | null, exportId?: Id): Id {
    if (!/^[A-Za-z0-9._-]+$/u.test(directoryName))
      throw new AppError('UNSAFE_PATH', 'Export directory name is unsafe', 400);
    const id = exportId ?? randomUUID();
    const stamp = now();
    try {
      this.database.sqlite
        .prepare(
          `INSERT INTO publication_exports(id,package_id,workflow_step_id,status,directory_name,created_at,updated_at)
           VALUES(?,?,?,'PENDING',?,?,?)`,
        )
        .run(id, packageId, workflowStepId ?? null, directoryName, stamp, stamp);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/u.test(error.message))
        throw new AppError('EXPORT_CONFLICT', 'An export for this package is already active', 409);
      throw error;
    }
    return id;
  }

  setStatus(
    id: Id,
    status: PublicationExportDto['status'],
    manifest?: PublicationManifest | null,
    error?: { code: string; message: string } | null,
  ): PublicationExportDto {
    const stamp = now();
    const startedAt = status === 'RUNNING' ? stamp : null;
    const completedAt = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? stamp : null;
    this.database.sqlite
      .prepare(
        `UPDATE publication_exports SET status=?,manifest=COALESCE(?,manifest),error=?,started_at=COALESCE(?,started_at),
          completed_at=COALESCE(?,completed_at),updated_at=? WHERE id=?`,
      )
      .run(
        status,
        manifest ? json(manifest) : null,
        error ? json(error) : null,
        startedAt,
        completedAt,
        stamp,
        id,
      );
    const result = this.get(id);
    if (!result) throw new AppError('EXPORT_NOT_FOUND', 'Publication export not found', 404);
    return result;
  }
}
