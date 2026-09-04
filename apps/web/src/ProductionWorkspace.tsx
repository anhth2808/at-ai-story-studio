import { useEffect, useMemo, useState } from 'react';
import type {
  ProductionInterventionDto,
  ProductionPlanResult,
  ProductionPreflightResult,
  ProductionProfileDto,
  ProductionRunDto,
  ProductionScope,
  ProductionStageDto,
  PublicationExportDto,
  PublicationPackageDto,
} from '@studio/shared';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type ProductionStatus = {
  run: ProductionRunDto;
  stages: ProductionStageDto[];
  interventions: ProductionInterventionDto[];
};
type ProductionWorkspaceProps = {
  projectId: string;
  request: Request;
  onError: (message: string) => void;
};

type ScopeMode = 'FULL_PROJECT' | 'CHAPTER_RANGE';

const stageLabels: Record<string, string> = {
  STORY: 'Story',
  CHAPTERS: 'Chapters',
  AUDIO: 'Lời thoại',
  SCENES: 'Cảnh',
  VISUAL_PROFILES: 'Hồ sơ hình ảnh',
  VISUAL_PROMPTS: 'Gói prompt hình ảnh',
  SCENE_IMAGES: 'Ảnh cảnh',
  AI_MOTION: 'Chuyển động AI',
  TIMELINE: 'Timeline',
  RENDER: 'Kết xuất',
  PUBLICATION_PACKAGE: 'Gói xuất bản',
};

function assetUrl(path: string): string {
  return /^https?:\/\//u.test(path) ? path : `${window.location.origin}${path}`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Không thể thực hiện thao tác production';
}

export function ProductionWorkspace({ projectId, request, onError }: ProductionWorkspaceProps) {
  const [profiles, setProfiles] = useState<ProductionProfileDto[]>([]);
  const [profileId, setProfileId] = useState('');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('FULL_PROJECT');
  const [startChapter, setStartChapter] = useState('1');
  const [endChapter, setEndChapter] = useState('1');
  const [preflight, setPreflight] = useState<ProductionPreflightResult | null>(null);
  const [plan, setPlan] = useState<ProductionPlanResult | null>(null);
  const [status, setStatus] = useState<ProductionStatus | null>(null);
  const [packageRecord, setPackageRecord] = useState<PublicationPackageDto | null>(null);
  const [exports, setExports] = useState<PublicationExportDto[]>([]);
  const [directoryName, setDirectoryName] = useState('release');
  const [thumbnailAssetId, setThumbnailAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataDescription, setMetadataDescription] = useState('');

  const scope = useMemo<ProductionScope>(() => {
    if (scopeMode === 'FULL_PROJECT') return { type: 'FULL_PROJECT' };
    return {
      type: 'CHAPTER_RANGE',
      startChapter: Math.max(1, Number(startChapter) || 1),
      endChapter: Math.max(1, Number(endChapter) || 1),
    };
  }, [endChapter, scopeMode, startChapter]);

  const load = async (): Promise<void> => {
    try {
      const nextProfiles = await request<ProductionProfileDto[]>(
        `/api/projects/${projectId}/production/profiles`,
      );
      setProfiles(nextProfiles);
      setProfileId(
        (current) =>
          current ||
          nextProfiles.find((profile) => profile.key === 'BALANCED')?.id ||
          nextProfiles[0]?.id ||
          '',
      );
      const runs = await request<ProductionRunDto[]>(
        `/api/projects/${projectId}/production/runs?limit=1`,
      );
      const latest = runs[0];
      if (!latest) {
        setStatus(null);
        setPackageRecord(null);
        setExports([]);
        setThumbnailAssetId('');
        return;
      }
      const nextStatus = await request<ProductionStatus>(
        `/api/projects/${projectId}/production/runs/${latest.id}`,
      );
      setStatus(nextStatus);
      const nextPackage = await request<PublicationPackageDto>(
        `/api/projects/${projectId}/production/runs/${latest.id}/publication-package`,
      ).catch(() => null);
      setPackageRecord(nextPackage);
      setThumbnailAssetId(nextPackage?.thumbnail?.assetId ?? '');
      setExports(
        nextPackage
          ? await request<PublicationExportDto[]>(
              `/api/projects/${projectId}/production/packages/${nextPackage.id}/exports`,
            ).catch(() => [])
          : [],
      );
      if (nextPackage?.metadata) {
        setMetadataTitle(nextPackage.metadata.title);
        setMetadataDescription(nextPackage.metadata.description);
      }
    } catch (cause) {
      onError(errorMessage(cause));
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [projectId]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const input = (): Record<string, unknown> => ({
    scope,
    ...(profileId ? { profileId } : {}),
  });

  const runCommand = async (path: string, body: Record<string, unknown> = {}): Promise<void> => {
    await request(path, { method: 'POST', body: JSON.stringify(body) });
  };

  const createRun = (): Promise<void> =>
    run(async () => {
      const created = await request<ProductionStatus>(
        `/api/projects/${projectId}/production/runs`,
        {
          method: 'POST',
          body: JSON.stringify(input()),
        },
      );
      setStatus(created);
      setPlan(null);
      setPreflight(null);
    });

  return (
    <div className="production-workspace">
      <div className="panel">
        <div className="story-toolbar">
          <div>
            <h3>Pipeline sản xuất</h3>
            <p className="muted">
              Kiểm tra đầu vào, lập kế hoạch giới hạn và theo dõi từng bước. GPU chỉ chạy khi bạn
              bấm bắt đầu.
            </p>
          </div>
          <span className="status-pill">{status?.run.status ?? 'Chưa tạo lượt'}</span>
        </div>
        <div className="actions">
          <label>
            Hồ sơ
            <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              <option value="">Mặc định BALANCED</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.key} v{profile.revision}
                </option>
              ))}
            </select>
          </label>
          <label>
            Phạm vi
            <select
              value={scopeMode}
              onChange={(event) => setScopeMode(event.target.value as ScopeMode)}
            >
              <option value="FULL_PROJECT">Toàn bộ project</option>
              <option value="CHAPTER_RANGE">Khoảng chapter</option>
            </select>
          </label>
          {scopeMode === 'CHAPTER_RANGE' && (
            <>
              <label>
                Từ chapter
                <input
                  min="1"
                  type="number"
                  value={startChapter}
                  onChange={(event) => setStartChapter(event.target.value)}
                />
              </label>
              <label>
                Đến chapter
                <input
                  min="1"
                  type="number"
                  value={endChapter}
                  onChange={(event) => setEndChapter(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setPreflight(
                  await request<ProductionPreflightResult>(
                    `/api/projects/${projectId}/production/preflight`,
                    { method: 'POST', body: JSON.stringify(input()) },
                  ),
                ),
              )
            }
          >
            Kiểm tra đầu vào
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setPlan(
                  await request<ProductionPlanResult>(
                    `/api/projects/${projectId}/production/plan`,
                    { method: 'POST', body: JSON.stringify(input()) },
                  ),
                ),
              )
            }
          >
            Lập kế hoạch
          </button>
          <button className="secondary" disabled={busy} onClick={() => void createRun()}>
            Tạo lượt sản xuất
          </button>
          {status && ['DRAFT', 'READY', 'FAILED'].includes(status.run.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  runCommand(`/api/projects/${projectId}/production/runs/${status.run.id}/start`, {
                    expectedRowVersion: status.run.rowVersion,
                  }),
                )
              }
            >
              Bắt đầu sản xuất
            </button>
          )}
          {status?.run.status === 'RUNNING' && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  runCommand(`/api/projects/${projectId}/production/runs/${status.run.id}/pause`, {
                    expectedRowVersion: status.run.rowVersion,
                  }),
                )
              }
            >
              Tạm dừng
            </button>
          )}
          {status && ['PAUSED', 'WAITING_FOR_USER'].includes(status.run.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  runCommand(`/api/projects/${projectId}/production/runs/${status.run.id}/resume`, {
                    expectedRowVersion: status.run.rowVersion,
                  }),
                )
              }
            >
              Tiếp tục sau khi xử lý
            </button>
          )}
          {status && !['CANCELLED', 'COMPLETED'].includes(status.run.status) && (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  runCommand(`/api/projects/${projectId}/production/runs/${status.run.id}/cancel`, {
                    expectedRowVersion: status.run.rowVersion,
                  }),
                )
              }
            >
              Hủy run
            </button>
          )}
        </div>
        {preflight && (
          <div className="job-list">
            <strong>Kiểm tra đầu vào: {preflight.status}</strong>
            {preflight.issues.length === 0 ? (
              <p className="muted">Không có cảnh báo.</p>
            ) : (
              preflight.issues.map((issue) => (
                <div className="job" key={`${issue.code}-${issue.stage ?? 'global'}`}>
                  <strong>
                    {issue.severity} · {issue.code}
                  </strong>
                  <span>{issue.message}</span>
                  <small>{issue.action}</small>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {plan && (
        <div className="panel">
          <h3>Kế hoạch giới hạn</h3>
          <div className="status-grid">
            <span>{plan.stages.length} bước</span>
            <span>
              Ước tính:{' '}
              {plan.estimate.durationMs
                ? `${Math.round(plan.estimate.durationMs / 60_000)} phút`
                : 'chưa biết'}
            </span>
            <span>
              {plan.blockers.length ? `${plan.blockers.length} điểm chặn` : 'Không có điểm chặn'}
            </span>
          </div>
          <div className="job-list">
            {plan.stages.map((stage) => (
              <div className="job" key={stage.key}>
                <strong>
                  {stage.ordinal + 1}. {stageLabels[stage.key] ?? stage.key}
                </strong>
                <span>
                  {stage.classification} · {stage.progress.current}/{stage.progress.total}
                </span>
                <small>
                  {stage.reusableCount} dùng lại · {stage.buildCount} cần làm · {stage.reviewCount}{' '}
                  chờ duyệt
                </small>
              </div>
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="panel">
          <div className="story-toolbar">
            <div>
              <h3>Tiến độ lượt sản xuất</h3>
              <p className="muted">
                {status.run.progress.current}/{status.run.progress.total} đơn vị · dấu vân tay{' '}
                {status.run.fingerprint.slice(0, 12)}
              </p>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy || !['RUNNING'].includes(status.run.status)}
                onClick={() =>
                  void run(() =>
                    runCommand(
                      `/api/projects/${projectId}/production/runs/${status.run.id}/advance`,
                    ),
                  )
                }
              >
                Đồng bộ stage
              </button>
            </div>
          </div>
          <div className="job-list">
            {status.stages.map((stage) => (
              <div className="job" key={stage.id}>
                <strong>
                  {stage.ordinal + 1}. {stageLabels[stage.key] ?? stage.key}
                </strong>
                <span>
                  {stage.status} · {stage.progress.current}/{stage.progress.total}
                </span>
                <small>
                  {stage.reusableCount} dùng lại · {stage.generatedCount} đã tạo ·{' '}
                  {stage.blockedCount} bị chặn
                </small>
                {stage.status === 'FAILED' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        runCommand(
                          `/api/projects/${projectId}/production/runs/${status.run.id}/stages/${stage.key}/retry`,
                        ),
                      )
                    }
                  >
                    Thử lại bước
                  </button>
                )}
              </div>
            ))}
          </div>
          {status.interventions.length > 0 && (
            <div className="job-list">
              <strong>Cần người dùng xử lý</strong>
              {status.interventions.map((intervention) => (
                <div className="job" key={intervention.id}>
                  <strong>
                    {intervention.severity} · {intervention.type}
                  </strong>
                  <span>{intervention.message}</span>
                  <small>{intervention.actions.join(' · ')}</small>
                  <div className="actions">
                    <span className="muted">Trạng thái: {intervention.status}</span>
                    {intervention.status === 'OPEN' && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            runCommand(
                              `/api/projects/${projectId}/production/runs/${status.run.id}/interventions/${intervention.id}/resolve`,
                              { resolution: { source: 'production-ui' } },
                            ),
                          )
                        }
                      >
                        Đánh dấu đã xử lý
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {packageRecord && (
        <div className="panel">
          <h3>Gói xuất bản</h3>
          <p className="muted">
            Bản sửa {packageRecord.revision} · {packageRecord.status} ·{' '}
            {packageRecord.subtitles.length} tệp phụ đề
          </p>
          {packageRecord.validation.map((issue) => (
            <div
              className={issue.severity === 'BLOCKING' ? 'error' : 'job'}
              key={`${issue.code}-${issue.message}`}
            >
              <strong>
                {issue.severity} · {issue.code}
              </strong>
              <span>{issue.message}</span>
              <small>{issue.action}</small>
            </div>
          ))}
          {packageRecord.manifest?.video && (
            <div className="package-media">
              <video
                controls
                preload="metadata"
                src={assetUrl(packageRecord.manifest.video.url)}
                aria-label="Video thành phẩm"
              />
              <a
                href={assetUrl(packageRecord.manifest.video.url)}
                download={packageRecord.manifest.video.exportName}
              >
                Tải video thành phẩm
              </a>
            </div>
          )}
          <div className="field">
            <label htmlFor="publication-title">Tiêu đề xuất bản</label>
            <input
              id="publication-title"
              value={metadataTitle}
              onChange={(event) => setMetadataTitle(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="publication-description">Mô tả xuất bản</label>
            <textarea
              id="publication-description"
              value={metadataDescription}
              onChange={(event) => setMetadataDescription(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="publication-thumbnail">Asset ID ảnh thumbnail</label>
            <input
              id="publication-thumbnail"
              value={thumbnailAssetId}
              onChange={(event) => setThumbnailAssetId(event.target.value)}
              placeholder="Dán ID từ asset đã quản lý"
            />
          </div>
          <div className="actions">
            <button
              disabled={busy || !metadataTitle.trim() || !metadataDescription.trim()}
              onClick={() =>
                void run(async () => {
                  const updated = await request<PublicationPackageDto>(
                    `/api/projects/${projectId}/production/packages/${packageRecord.id}/metadata`,
                    {
                      method: 'PATCH',
                      body: JSON.stringify({
                        expectedRevision: packageRecord.revision,
                        title: metadataTitle,
                        description: metadataDescription,
                      }),
                    },
                  );
                  setPackageRecord(updated);
                })
              }
            >
              Lưu metadata
            </button>
            <button
              className="secondary"
              disabled={busy || !thumbnailAssetId.trim()}
              onClick={() =>
                void run(async () => {
                  const updated = await request<PublicationPackageDto>(
                    `/api/projects/${projectId}/production/packages/${packageRecord.id}/thumbnail`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        assetId: thumbnailAssetId.trim(),
                        expectedRevision: packageRecord.revision,
                      }),
                    },
                  );
                  setPackageRecord(updated);
                })
              }
            >
              Chọn thumbnail
            </button>
            <label>
              Thư mục xuất
              <input
                value={directoryName}
                onChange={(event) => setDirectoryName(event.target.value)}
                pattern="[A-Za-z0-9._-]+"
              />
            </label>
            <button
              className="secondary"
              disabled={busy || packageRecord.status !== 'READY'}
              onClick={() =>
                void run(async () => {
                  await request(
                    `/api/projects/${projectId}/production/packages/${packageRecord.id}/export`,
                    {
                      method: 'POST',
                      body: JSON.stringify({ directoryName }),
                    },
                  );
                })
              }
            >
              Xuất gói
            </button>
          </div>
          {packageRecord.chapterMarkers.length > 0 && (
            <details className="package-markers">
              <summary>Mốc chapter đo từ audio</summary>
              <ol>
                {packageRecord.chapterMarkers.map((marker) => (
                  <li key={marker.chapterId}>
                    Chương {marker.chapterNumber}: {marker.title} ·{' '}
                    {Math.floor(marker.offsetMs / 60_000)}:
                    {String(Math.floor(marker.offsetMs / 1_000) % 60).padStart(2, '0')}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {exports.length > 0 && (
            <div className="job-list">
              <strong>Lịch sử xuất</strong>
              {exports.map((item) => (
                <div className="job" key={item.id}>
                  <span>{item.directoryName}</span>
                  <small>{item.status}</small>
                </div>
              ))}
            </div>
          )}
          <p className="muted">
            Gói này chỉ chuẩn bị tệp và manifest trung lập nền tảng; chưa có xuất bản YouTube.
          </p>
          {packageRecord.manifest && (
            <pre className="code-block">{JSON.stringify(packageRecord.manifest, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
