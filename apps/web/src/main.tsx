import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ChapterDto,
  Health,
  JobDto,
  ProjectDto,
  RenderConfig,
  StatusSummary,
} from '@studio/shared';
import './styles.css';
const API_BASE = 'http://127.0.0.1:3001';
type ProjectDetail = { project: ProjectDto; chapters: ChapterDto[] };
type RenderAsset = { id: string; url: string; mediaType: string };
type AudioAsset = { id: string; url: string; mediaType: string };
type SubtitleAsset = { srt: string; url: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isMultipart = init?.body instanceof FormData;
  const headers = isMultipart
    ? { ...(init?.headers ?? {}) }
    : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) };
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function apiText(path: string): Promise<string> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.text();
}
async function loadRender(projectId: string): Promise<RenderAsset | null> {
  const asset = await api<RenderAsset>(`/api/projects/${projectId}/render`).catch(() => null);
  return asset
    ? { ...asset, url: asset.url.startsWith('http') ? asset.url : `${API_BASE}${asset.url}` }
    : null;
}

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [selected, setSelected] = useState<ProjectDto | null>(null);
  const [chapters, setChapters] = useState<ChapterDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [status, setStatus] = useState<StatusSummary | null>(null);
  const [audio, setAudio] = useState<AudioAsset | null>(null);
  const [subtitle, setSubtitle] = useState<SubtitleAsset | null>(null);
  const [render, setRender] = useState<RenderAsset | null>(null);
  const [renderConfig, setRenderConfig] = useState<RenderConfig | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Story');
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const [nextHealth, nextProjects] = await Promise.all([
        api<Health>('/api/health'),
        api<ProjectDto[]>('/api/projects'),
      ]);
      setHealth(nextHealth);
      setProjects(nextProjects);
      if (selected) {
        const detail = await api<ProjectDetail>(`/api/projects/${selected.id}`);
        setSelected(detail.project);
        setChapters(detail.chapters);
        const chapterId = activeChapterId ?? detail.chapters[0]?.id;
        setActiveChapterId((current) => current ?? detail.chapters[0]?.id ?? null);
        setStatus(
          await api<StatusSummary>(
            chapterId ? `/api/chapters/${chapterId}/status` : `/api/projects/${selected.id}/status`,
          ),
        );
        const currentJobs = await Promise.all(
          jobs.map((job) => api<JobDto>(`/api/jobs/${job.id}`).catch(() => job)),
        );
        setJobs(currentJobs);
        setRender(await loadRender(selected.id));
        if (chapterId) {
          const [nextAudio, nextSubtitle] = await Promise.all([
            api<AudioAsset>(`/api/chapters/${chapterId}/audio`).catch(() => null),
            apiText(`/api/chapters/${chapterId}/subtitles`).catch(() => null),
          ]);
          setAudio(
            nextAudio
              ? {
                  ...nextAudio,
                  url: nextAudio.url.startsWith('http')
                    ? nextAudio.url
                    : `${API_BASE}${nextAudio.url}`,
                }
              : null,
          );
          setSubtitle(
            nextSubtitle
              ? { srt: nextSubtitle, url: `/api/chapters/${chapterId}/subtitles` }
              : null,
          );
        } else {
          setAudio(null);
          setSubtitle(null);
        }
        setRenderConfig(await api<RenderConfig>(`/api/projects/${selected.id}/render-config`));
      } else {
        setAudio(null);
        setSubtitle(null);
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể kết nối API');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [selected?.id, jobs.length, activeChapterId]);

  const createProject = async (): Promise<void> => {
    const title = window.prompt('Tên dự án');
    if (!title) return;
    await api<ProjectDto>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: '',
        language: 'vi-VN',
        workflowType: 'AUDIO_STORY',
      }),
    });
    await refresh();
  };
  const editProject = async (): Promise<void> => {
    if (!selected) return;
    const title = window.prompt('Tên dự án', selected.title);
    if (!title || title === selected.title) return;
    await api(`/api/projects/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    await refresh();
  };

  const deleteProject = async (): Promise<void> => {
    if (!selected || !window.confirm(`Xóa dự án "${selected.title}"?`)) return;
    await api(`/api/projects/${selected.id}`, { method: 'DELETE' });
    setSelected(null);
    setChapters([]);
    setJobs([]);
    setStatus(null);
    setRender(null);
    setRenderConfig(null);
    await refresh();
  };

  const openProject = async (project: ProjectDto): Promise<void> => {
    const detail = await api<ProjectDetail>(`/api/projects/${project.id}`);
    setSelected(detail.project);
    setChapters(detail.chapters);
    setActiveChapterId(detail.chapters[0]?.id ?? null);
    setJobs([]);
    setStatus(await api<StatusSummary>(`/api/projects/${project.id}/status`));
    setRender(await loadRender(project.id));
  };

  const addChapter = async (): Promise<void> => {
    if (!selected) return;
    const title = window.prompt('Tiêu đề chương');
    if (!title) return;
    await api(`/api/projects/${selected.id}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ title, content: 'Nhập nội dung chương tại đây.' }),
    });
    await refresh();
  };

  const saveChapter = async (chapter: ChapterDto): Promise<void> => {
    await api(`/api/chapters/${chapter.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: chapter.title,
        content: chapter.content,
        expectedRevision: chapter.revision,
      }),
    });
    await refresh();
  };

  const track = async (ids: string[]): Promise<void> => {
    const next = await Promise.all(ids.map((id) => api<JobDto>(`/api/jobs/${id}`)));
    setJobs((current) => [...current.filter((job) => !ids.includes(job.id)), ...next]);
  };

  const generateAudio = async (): Promise<void> => {
    const chapter = chapters.find((item) => item.id === activeChapterId) ?? chapters[0];
    if (!chapter) return;
    const result = await api<{ jobIds: string[] }>(`/api/chapters/${chapter.id}/tts`, {
      method: 'POST',
    });
    await track(result.jobIds);
  };

  const generateSubtitles = async (): Promise<void> => {
    const chapter = chapters.find((item) => item.id === activeChapterId) ?? chapters[0];
    if (!chapter) return;
    const result = await api<{ jobId: string }>(`/api/chapters/${chapter.id}/subtitles`, {
      method: 'POST',
    });
    await track([result.jobId]);
  };

  const saveSubtitle = async (): Promise<void> => {
    if (!activeChapter || !subtitle) return;
    await api(`/api/chapters/${activeChapter.id}/subtitles`, {
      method: 'PUT',
      body: JSON.stringify({ srt: subtitle.srt }),
    });
    await refresh();
  };

  const renderVideo = async (): Promise<void> => {
    if (!selected) return;
    const result = await api<{ jobId: string }>(`/api/projects/${selected.id}/render`, {
      method: 'POST',
    });
    await track([result.jobId]);
  };
  const updateRenderConfig = async (patch: Partial<RenderConfig>): Promise<void> => {
    if (!selected || !renderConfig) return;
    const next = { ...renderConfig, ...patch };
    await api(`/api/projects/${selected.id}/render-config`, {
      method: 'PATCH',
      body: JSON.stringify(next),
    });
    setRenderConfig(next);
    await refresh();
  };

  const uploadAsset = async (file: File): Promise<void> => {
    if (!selected) return;
    const form = new FormData();
    form.append('file', file);
    await api(`/api/projects/${selected.id}/assets`, { method: 'POST', body: form });
    await refresh();
  };

  const activeChapter = chapters.find((item) => item.id === activeChapterId) ?? chapters[0];
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL VIDEO WORKSPACE</p>
          <h1>AI Story Studio</h1>
        </div>
        <div className="health">
          {health
            ? Object.entries(health.checks).map(([name, check]) => (
                <span key={name} className={check.ok ? 'ok' : 'bad'}>
                  {name}
                </span>
              ))
            : 'Đang kiểm tra hệ thống...'}
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      <section className="layout">
        <aside>
          <div className="aside-head">
            <h2>Dự án</h2>
            <button onClick={() => void createProject()}>+ Tạo</button>
          </div>
          {projects.length === 0 ? (
            <p className="muted">Chưa có dự án.</p>
          ) : (
            projects.map((project) => (
              <button
                className={`project ${selected?.id === project.id ? 'active' : ''}`}
                key={project.id}
                onClick={() => void openProject(project)}
              >
                <strong>{project.title}</strong>
                <small>
                  {project.language} · {project.workflowType}
                </small>
              </button>
            ))
          )}
        </aside>
        {selected ? (
          <section className="editor">
            <div className="editor-head">
              <div>
                <p className="eyebrow">PROJECT</p>
                <h2>{selected.title}</h2>
              </div>
              <div className="editor-actions">
                <button className="secondary" onClick={() => void editProject()}>
                  Đổi tên
                </button>
                <button className="danger" onClick={() => void deleteProject()}>
                  Xóa
                </button>
              </div>
              <div className="tabs">
                {['Story', 'Audio', 'Video', 'Render'].map((item) => (
                  <button
                    className={tab === item ? 'selected' : ''}
                    key={item}
                    onClick={() => setTab(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              {status && (
                <div className="status-grid" aria-label="Trạng thái dự án">
                  <span>Narration: {status.narration}</span>
                  <span>Phụ đề: {status.subtitles}</span>
                  <span>Nền: {status.background}</span>
                  <span>Render: {status.render}</span>
                </div>
              )}
            </div>
            {tab === 'Story' && (
              <>
                <div className="section-head">
                  <h3>Chapters</h3>
                  <button onClick={() => void addChapter()}>+ Chương</button>
                </div>
                {chapters.map((chapter) => (
                  <article className="chapter" key={chapter.id}>
                    <input
                      value={chapter.title}
                      onChange={(event) =>
                        setChapters((items) =>
                          items.map((item) =>
                            item.id === chapter.id ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <textarea
                      value={chapter.content}
                      onChange={(event) =>
                        setChapters((items) =>
                          items.map((item) =>
                            item.id === chapter.id
                              ? { ...item, content: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <div className="chapter-foot">
                      <span>
                        Chương {chapter.number} · revision {chapter.revision}
                      </span>
                      <button
                        className="secondary"
                        onClick={() => setActiveChapterId(chapter.id)}
                        aria-pressed={activeChapter?.id === chapter.id}
                      >
                        {activeChapter?.id === chapter.id ? 'Đang chọn' : 'Chọn chương'}
                      </button>
                      <button onClick={() => void saveChapter(chapter)}>Lưu nội dung</button>
                    </div>
                  </article>
                ))}
              </>
            )}
            {tab === 'Audio' && (
              <div className="panel">
                <h3>Narration</h3>
                <p className="muted">Tách văn bản, tạo TTS theo từng đoạn, sau đó ghép audio.</p>
                <div className="actions">
                  <button disabled={!activeChapter} onClick={() => void generateAudio()}>
                    Tạo narration
                  </button>
                  <button disabled={!activeChapter} onClick={() => void generateSubtitles()}>
                    Tạo phụ đề SRT
                  </button>
                </div>
                {audio && <audio controls preload="metadata" src={audio.url} />}
                <label className="field">
                  <span>Phụ đề SRT hiện tại</span>
                  <textarea
                    value={subtitle?.srt ?? ''}
                    placeholder="Tạo phụ đề hoặc dán SRT tại đây."
                    onChange={(event) =>
                      setSubtitle((current) => ({
                        srt: event.target.value,
                        url: current?.url ?? '',
                      }))
                    }
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!activeChapter || !subtitle?.srt.trim()}
                  onClick={() => void saveSubtitle()}
                >
                  Lưu phụ đề
                </button>
                <JobList
                  jobs={jobs.filter(
                    (job) =>
                      job.type.includes('TTS') ||
                      job.type === 'MERGE_AUDIO' ||
                      job.type === 'SUBTITLE',
                  )}
                  onChanged={() => void refresh()}
                />
              </div>
            )}
            {tab === 'Video' && (
              <div className="panel">
                <h3>Background và music</h3>
                <p className="muted">
                  Tệp được lưu vào workspace, không giữ tên upload làm đường dẫn nội bộ.
                </p>
                <div className="upload-grid">
                  <label className="upload">
                    Ảnh hoặc video nền
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadAsset(file);
                      }}
                    />
                  </label>
                  <label className="upload">
                    Nhạc nền
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadAsset(file);
                      }}
                    />
                  </label>
                </div>
                <div className="actions">
                  <span className="muted">Nền: {status?.background ?? 'PENDING'}</span>
                  <span className="muted">Render: {status?.render ?? 'PENDING'}</span>
                  <button
                    className="secondary"
                    onClick={() =>
                      void api(`/api/projects/${selected.id}/music`, { method: 'DELETE' }).then(
                        refresh,
                      )
                    }
                  >
                    Xóa nhạc nền
                  </button>
                </div>
              </div>
            )}
            {tab === 'Render' && (
              <div className="panel">
                <h3>Render MP4</h3>
                <p className="muted">
                  Render dùng narration, background hiện tại, phụ đề nếu có và music nếu bật.
                </p>
                {renderConfig && (
                  <div className="actions render-config">
                    <label>
                      Khung hình
                      <select
                        value={`${renderConfig.width}x${renderConfig.height}`}
                        onChange={(event) => {
                          const portrait = event.target.value === '1080x1920';
                          void updateRenderConfig(
                            portrait
                              ? { width: 1080, height: 1920 }
                              : { width: 1920, height: 1080 },
                          );
                        }}
                      >
                        <option value="1920x1080">Ngang 16:9</option>
                        <option value="1080x1920">Dọc 9:16</option>
                      </select>
                    </label>
                    <label>
                      FPS
                      <select
                        value={renderConfig.fps}
                        onChange={(event) =>
                          void updateRenderConfig({
                            fps: Number(event.target.value) as RenderConfig['fps'],
                          })
                        }
                      >
                        {[24, 25, 30, 60].map((fps) => (
                          <option key={fps} value={fps}>
                            {fps}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={renderConfig.musicEnabled}
                        onChange={(event) =>
                          void updateRenderConfig({ musicEnabled: event.target.checked })
                        }
                      />
                      Bật nhạc nền
                    </label>
                  </div>
                )}
                <button disabled={!activeChapter} onClick={() => void renderVideo()}>
                  Render video
                </button>
                <JobList
                  jobs={jobs.filter((job) => job.type === 'RENDER')}
                  onChanged={() => void refresh()}
                />
                {render && <video className="video" controls src={render.url} />}
              </div>
            )}
          </section>
        ) : (
          <section className="empty">
            <h2>Bắt đầu một video kể chuyện</h2>
            <p>Tạo dự án, thêm chương, sau đó tạo audio và render MP4 từ nội dung thủ công.</p>
            <button onClick={() => void createProject()}>Tạo dự án đầu tiên</button>
          </section>
        )}
      </section>
    </main>
  );
}

function JobList({ jobs, onChanged }: { jobs: JobDto[]; onChanged?: () => void }) {
  if (!jobs.length) return <p className="muted">Chưa có job trong phiên này.</p>;
  const changeJob = async (job: JobDto, action: 'retry' | 'cancel'): Promise<void> => {
    await api(`/api/jobs/${job.id}/${action}`, { method: 'POST' });
    onChanged?.();
  };
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <div className="job" key={job.id}>
          <span>{job.type}</span>
          <strong className={`status-${job.status.toLowerCase()}`}>{job.status}</strong>
          <small>
            {Math.round(job.progress * 100)}% · lần thử {job.attempts}
          </small>
          {job.error && <em>{job.error}</em>}
          {job.status === 'FAILED' && (
            <button className="secondary" onClick={() => void changeJob(job, 'retry')}>
              Thử lại
            </button>
          )}
          {(job.status === 'PENDING' || job.status === 'RUNNING') && (
            <button className="secondary" onClick={() => void changeJob(job, 'cancel')}>
              Hủy
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
