import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ChapterDto,
  ChapterPlanItem,
  Health,
  JobDto,
  ProjectDto,
  RenderConfig,
  StatusSummary,
  StoryBlueprint,
  StorySettings,
  StorySettingsDto,
  StorySnapshotDto,
} from '@studio/shared';
import './styles.css';
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
type ProjectDetail = { project: ProjectDto; chapters: ChapterDto[] };
type RenderAsset = { id: string; url: string; mediaType: string };
const defaultStorySettings: StorySettings = {
  mode: 'IDEA_TO_STORY',
  idea: '',
  language: 'vi-VN',
  genre: '',
  tone: '',
  audience: '',
  targetChapterCount: 3,
  chapterLength: 800,
  pacing: 'MEDIUM',
  contentBoundaries: [],
  characterNotes: '',
  worldNotes: '',
  plotRequirements: '',
  generation: {
    model: null,
    contextBudget: 5_000,
    temperature: 0.7,
    maxOutputTokens: 8_000,
  },
};
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
type StoryJobScheduleDto = { executionId: string; jobId?: string; jobIds?: string[] };
const storyApi = {
  snapshot: (projectId: string) => api<StorySnapshotDto>(`/api/projects/${projectId}/story`),
  saveSettings: (projectId: string, settings: StorySettings) =>
    api<StorySettingsDto>(`/api/projects/${projectId}/story/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  generate: (path: string, body: Record<string, unknown> = {}) =>
    api<StoryJobScheduleDto>(path, { method: 'POST', body: JSON.stringify(body) }),
  retryJob: (jobId: string) => api(`/api/jobs/${jobId}/retry`, { method: 'POST' }),
  updateBlueprint: (projectId: string, blueprint: StoryBlueprint) =>
    api(`/api/projects/${projectId}/story/blueprint`, {
      method: 'PUT',
      body: JSON.stringify(blueprint),
    }),
  updatePlanItem: (projectId: string, item: ChapterPlanItem) =>
    api(`/api/projects/${projectId}/story/plan/items/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    }),
  cancelJob: (jobId: string) => api(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),
};
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
  const [renderConfig, setRenderConfig] = useState<RenderConfig | null>(null);
  const [story, setStory] = useState<StorySnapshotDto | null>(null);
  const [audio, setAudio] = useState<AudioAsset | null>(null);
  const [subtitle, setSubtitle] = useState<SubtitleAsset | null>(null);
  const [render, setRender] = useState<RenderAsset | null>(null);
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
        setStory(await storyApi.snapshot(selected.id));
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
        setStory(null);
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
    setStory(null);
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
  const generateSummary = async (chapter: ChapterDto): Promise<void> => {
    await api(`/api/chapters/${chapter.id}/story/summary`, {
      method: 'POST',
      body: JSON.stringify({ expectedChapterRevision: chapter.revision }),
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
                <StoryWorkspace
                  projectId={selected.id}
                  story={story}
                  chapters={chapters}
                  activeChapterId={activeChapter?.id ?? null}
                  onChanged={() => void refresh()}
                  onError={setError}
                />
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
                      <span
                        className={`origin-badge ${chapter.origin === 'GENERATED' ? 'generated' : ''}`}
                      >
                        {chapter.origin === 'GENERATED' ? 'AI tạo - cần duyệt' : 'Thủ công'}
                      </span>
                      <button
                        className="secondary"
                        onClick={() => setActiveChapterId(chapter.id)}
                        aria-pressed={activeChapter?.id === chapter.id}
                      >
                        {activeChapter?.id === chapter.id ? 'Đang chọn' : 'Chọn chương'}
                      </button>
                      <button onClick={() => void saveChapter(chapter)}>Lưu nội dung</button>
                      <button
                        className="secondary"
                        onClick={() =>
                          void generateSummary(chapter).catch((cause) =>
                            setError(
                              cause instanceof Error ? cause.message : 'Không thể tạo tóm tắt',
                            ),
                          )
                        }
                      >
                        Tạo tóm tắt
                      </button>
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

function StoryWorkspace({
  projectId,
  story,
  chapters,
  activeChapterId,
  onChanged,
  onError,
}: {
  projectId: string;
  story: StorySnapshotDto | null;
  chapters: ChapterDto[];
  activeChapterId: string | null;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<StorySettings>(story?.settings ?? defaultStorySettings);
  const [blueprintEditing, setBlueprintEditing] = useState(false);
  const [blueprintDraft, setBlueprintDraft] = useState<StoryBlueprint | null>(
    story?.blueprint?.blueprint ?? null,
  );
  const [planDraft, setPlanDraft] = useState<ChapterPlanItem | null>(null);
  useEffect(() => {
    setDraft(story?.settings ?? defaultStorySettings);
  }, [story?.settings?.revision]);
  useEffect(() => {
    setBlueprintDraft(story?.blueprint?.blueprint ?? null);
    setBlueprintEditing(false);
    setPlanDraft(null);
  }, [story?.blueprint?.revision, story?.plan?.revision]);
  const setField = <K extends keyof StorySettings>(key: K, value: StorySettings[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const submitSettings = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await storyApi.saveSettings(projectId, draft);
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu cài đặt Story');
    }
  };
  const generate = async (path: string): Promise<void> => {
    try {
      await storyApi.generate(path);
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo nội dung Story');
    }
  };
  const saveBlueprint = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!blueprintDraft) return;
    try {
      await storyApi.updateBlueprint(projectId, blueprintDraft);
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu blueprint');
    }
  };
  const savePlanItem = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!planDraft) return;
    try {
      await storyApi.updatePlanItem(projectId, planDraft);
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu dàn ý chương');
    }
  };
  const setBlueprintField = <K extends keyof StoryBlueprint>(
    key: K,
    value: StoryBlueprint[K],
  ): void => {
    setBlueprintDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const setCharacterField = (
    characterId: string,
    key: 'name' | 'role' | 'personality',
    value: string,
  ): void => {
    setBlueprintDraft((current) =>
      current
        ? {
            ...current,
            characters: current.characters.map((character) =>
              character.id === characterId ? { ...character, [key]: value } : character,
            ),
          }
        : current,
    );
  };
  const setPlanField = <K extends keyof ChapterPlanItem>(
    key: K,
    value: ChapterPlanItem[K],
  ): void => {
    setPlanDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  if (!story) {
    return (
      <div className="story-empty">
        <strong>Đang tải Story...</strong>
        <span>Đang đọc trạng thái đã lưu từ SQLite.</span>
      </div>
    );
  }
  const settings = story.settings;
  const chapterJobFor = (planItemId: string) =>
    story.jobs.find((job) => job.type === 'GENERATE_CHAPTER' && job.entityId === planItemId);
  const generatePlanItem = async (planItemId: string): Promise<void> => {
    const existingChapter = chapters.find((chapter) => chapter.storyPlanItemId === planItemId);
    if (
      existingChapter?.origin === 'MANUAL' &&
      !window.confirm(
        'Chương này đã được sửa thủ công. Xác nhận yêu cầu tạo lại để kiểm tra xung đột?',
      )
    )
      return;
    const job = chapterJobFor(planItemId);
    try {
      if (job?.status === 'FAILED') {
        await storyApi.retryJob(job.id);
      } else {
        await storyApi.generate(
          `/api/projects/${projectId}/story/chapters/${planItemId}/generate`,
          {
            expectedPlanRevision: story.plan?.revision ?? null,
            expectedChapterRevision: existingChapter?.revision ?? null,
          },
        );
      }
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo chương');
    }
  };
  return (
    <div className="story-workspace">
      <div className="story-toolbar">
        <div>
          <p className="eyebrow">STORY ENGINE</p>
          <h3>Ý tưởng đến câu chuyện</h3>
          <p className="muted">
            Tạo từng lớp nội dung để duyệt. Story không tự tạo narration hay video.
          </p>
        </div>
        <div className={`readiness ${story?.omp.ready ? 'ready' : 'not-ready'}`}>
          <span aria-hidden="true" />
          <span>{story?.omp.ready ? 'OMP sẵn sàng' : 'OMP chưa sẵn sàng'}</span>
          {story?.omp.model && <small>{story.omp.model}</small>}
        </div>
      </div>
      <form className="story-settings" onSubmit={(event) => void submitSettings(event)}>
        <div className="story-settings-head">
          <div>
            <h4>Cài đặt câu chuyện</h4>
            <p className="muted">
              {settings
                ? `Revision ${settings.revision} đang được lưu trong SQLite.`
                : 'Chưa có cài đặt. Lưu để bắt đầu.'}
            </p>
          </div>
          <button type="submit">Lưu cài đặt</button>
        </div>
        <label className="field field-wide">
          <span>Ý tưởng chính</span>
          <textarea
            required
            maxLength={20_000}
            value={draft.idea}
            onChange={(event) => setField('idea', event.target.value)}
          />
        </label>
        <div className="story-field-grid">
          <label className="field">
            <span>Ngôn ngữ</span>
            <input
              required
              value={draft.language}
              onChange={(event) => setField('language', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Thể loại</span>
            <input
              required
              value={draft.genre}
              onChange={(event) => setField('genre', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Giọng kể</span>
            <input
              required
              value={draft.tone}
              onChange={(event) => setField('tone', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Đối tượng</span>
            <input
              required
              value={draft.audience}
              onChange={(event) => setField('audience', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Số chương</span>
            <input
              required
              min={1}
              max={200}
              type="number"
              value={draft.targetChapterCount}
              onChange={(event) => setField('targetChapterCount', Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Độ dài chương (từ)</span>
            <input
              required
              min={100}
              max={20_000}
              type="number"
              value={draft.chapterLength}
              onChange={(event) => setField('chapterLength', Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Nhịp truyện</span>
            <select
              value={draft.pacing}
              onChange={(event) =>
                setField('pacing', event.target.value as StorySettings['pacing'])
              }
            >
              <option value="SLOW">Chậm</option>
              <option value="MEDIUM">Vừa</option>
              <option value="FAST">Nhanh</option>
            </select>
          </label>
          <label className="field">
            <span>Model OMP (tuỳ chọn)</span>
            <input
              value={draft.generation.model ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  generation: { ...current.generation, model: event.target.value || null },
                }))
              }
            />
          </label>
        </div>
        <label className="field field-wide">
          <span>Ranh giới nội dung (mỗi dòng một mục)</span>
          <textarea
            value={draft.contentBoundaries.join('\n')}
            onChange={(event) =>
              setField(
                'contentBoundaries',
                event.target.value
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <div className="story-field-grid">
          <label className="field">
            <span>Ghi chú nhân vật</span>
            <textarea
              value={draft.characterNotes}
              onChange={(event) => setField('characterNotes', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Ghi chú thế giới</span>
            <textarea
              value={draft.worldNotes}
              onChange={(event) => setField('worldNotes', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Yêu cầu cốt truyện</span>
            <textarea
              value={draft.plotRequirements}
              onChange={(event) => setField('plotRequirements', event.target.value)}
            />
          </label>
        </div>
      </form>
      <div className="story-actions">
        <button
          disabled={!settings}
          onClick={() => void generate(`/api/projects/${projectId}/story/blueprint/generate`)}
        >
          Tạo blueprint
        </button>
        <button
          disabled={!story?.blueprint}
          onClick={() => void generate(`/api/projects/${projectId}/story/plans/generate`)}
        >
          Tạo dàn ý chương
        </button>
        <button
          disabled={!settings}
          className="secondary"
          onClick={() => void generate(`/api/projects/${projectId}/story/generate`)}
        >
          Chạy blueprint + dàn ý
        </button>
      </div>
      {story?.jobs.some((job) => job.type.startsWith('GENERATE_')) && (
        <div className="story-jobs">
          <div className="section-head">
            <h4>Tiến trình Story</h4>
            <span className="muted">Trạng thái đã lưu</span>
          </div>
          {story.jobs
            .filter((job) => job.type.startsWith('GENERATE_'))
            .map((job) => (
              <div className="story-job" key={job.id}>
                <span>{job.type.replaceAll('_', ' ')}</span>
                <strong className={`status-${job.status.toLowerCase()}`}>{job.status}</strong>
                <small>
                  {Math.round(job.progress * 100)}% · lần thử {job.attempts}
                </small>
                {job.error && <em>{job.error}</em>}
                {job.status === 'FAILED' && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void storyApi
                        .retryJob(job.id)
                        .then(onChanged)
                        .catch((cause) =>
                          onError(cause instanceof Error ? cause.message : 'Không thể thử lại'),
                        )
                    }
                  >
                    Thử lại
                  </button>
                )}
                {(job.status === 'PENDING' || job.status === 'RUNNING') && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void storyApi
                        .cancelJob(job.id)
                        .then(onChanged)
                        .catch((cause) =>
                          onError(cause instanceof Error ? cause.message : 'Không thể hủy job'),
                        )
                    }
                  >
                    Hủy
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
      {story?.blueprint && (
        <section className="story-output">
          <div className="section-head">
            <div>
              <h4>Blueprint · revision {story.blueprint.revision}</h4>
              <p>{story.blueprint.blueprint.premise}</p>
            </div>
            <div className="actions">
              {story.blueprint.metadata && (
                <small className="provenance">
                  Model: {story.blueprint.metadata.model ?? 'unknown'} ·{' '}
                  {story.blueprint.metadata.promptVersion}
                </small>
              )}
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setBlueprintDraft(story.blueprint!.blueprint);
                  setBlueprintEditing(true);
                }}
              >
                Sửa blueprint
              </button>
            </div>
          </div>
          {blueprintEditing && blueprintDraft ? (
            <form className="story-settings" onSubmit={(event) => void saveBlueprint(event)}>
              <label className="field field-wide">
                <span>Tiền đề</span>
                <textarea
                  required
                  value={blueprintDraft.premise}
                  onChange={(event) => setBlueprintField('premise', event.target.value)}
                />
              </label>
              <label className="field field-wide">
                <span>Hướng cốt truyện</span>
                <textarea
                  required
                  value={blueprintDraft.plotDirection}
                  onChange={(event) => setBlueprintField('plotDirection', event.target.value)}
                />
              </label>
              <div className="character-grid">
                {blueprintDraft.characters.map((character) => (
                  <label className="character-card" key={character.id}>
                    <strong>{character.name}</strong>
                    <span>ID ổn định: {character.id}</span>
                    <input
                      aria-label={`Tên ${character.id}`}
                      value={character.name}
                      onChange={(event) =>
                        setCharacterField(character.id, 'name', event.target.value)
                      }
                    />
                    <input
                      aria-label={`Vai trò ${character.id}`}
                      value={character.role}
                      onChange={(event) =>
                        setCharacterField(character.id, 'role', event.target.value)
                      }
                    />
                    <textarea
                      aria-label={`Tính cách ${character.id}`}
                      value={character.personality}
                      onChange={(event) =>
                        setCharacterField(character.id, 'personality', event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="actions">
                <button type="submit">Lưu revision blueprint</button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setBlueprintEditing(false)}
                >
                  Hủy
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="muted">{story.blueprint.blueprint.plotDirection}</p>
              <div className="chip-row">
                {story.blueprint.blueprint.themes.map((theme) => (
                  <span className="chip" key={theme}>
                    {theme}
                  </span>
                ))}
              </div>
              <div className="character-grid">
                {story.blueprint.blueprint.characters.map((character) => (
                  <article className="character-card" key={character.id}>
                    <strong>{character.name}</strong>
                    <span>{character.role}</span>
                    <small>
                      {character.ageRange} · {character.appearance}
                    </small>
                    <p>Muốn: {character.wants}</p>
                    <p>Sợ: {character.fears}</p>
                    <div className="chip-row">
                      {character.traits.map((trait) => (
                        <span className="chip" key={trait}>
                          {trait}
                        </span>
                      ))}
                    </div>
                    <p>{character.personality}</p>
                    <small>Arc: {character.arc}</small>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {story?.plan && (
        <section className="story-output">
          <div className="section-head">
            <h4>Dàn ý chương · revision {story.plan.revision}</h4>
            <span className="provenance">Blueprint {story.plan.blueprintRevision}</span>
          </div>
          <div className="plan-list">
            {story.plan.plan.items.map((item) => {
              const job = chapterJobFor(item.id);
              const existingChapter = chapters.find(
                (chapter) => chapter.storyPlanItemId === item.id,
              );
              const state =
                job?.status ?? (existingChapter?.origin === 'MANUAL' ? 'MANUAL_EDIT' : 'READY');
              return (
                <div className="plan-row" key={item.id}>
                  {planDraft?.id === item.id ? (
                    <form className="story-settings" onSubmit={(event) => void savePlanItem(event)}>
                      <strong>
                        Chỉnh sửa chương {item.chapterNumber} · ID {item.id}
                      </strong>
                      <label className="field">
                        <span>Tiêu đề</span>
                        <input
                          required
                          value={planDraft.title}
                          onChange={(event) => setPlanField('title', event.target.value)}
                        />
                      </label>
                      <label className="field field-wide">
                        <span>Tóm tắt</span>
                        <textarea
                          required
                          value={planDraft.summary}
                          onChange={(event) => setPlanField('summary', event.target.value)}
                        />
                      </label>
                      <label className="field field-wide">
                        <span>Mục đích chương</span>
                        <textarea
                          required
                          value={planDraft.purpose}
                          onChange={(event) => setPlanField('purpose', event.target.value)}
                        />
                      </label>
                      <label className="field field-wide">
                        <span>Bối cảnh</span>
                        <textarea
                          required
                          value={planDraft.setting}
                          onChange={(event) => setPlanField('setting', event.target.value)}
                        />
                      </label>
                      <label className="field field-wide">
                        <span>Xung đột</span>
                        <textarea
                          required
                          value={planDraft.conflict}
                          onChange={(event) => setPlanField('conflict', event.target.value)}
                        />
                      </label>
                      <label className="field field-wide">
                        <span>Hướng giải quyết</span>
                        <textarea
                          required
                          value={planDraft.resolution}
                          onChange={(event) => setPlanField('resolution', event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Nhịp cảm xúc</span>
                        <input
                          required
                          value={planDraft.emotionalArc}
                          onChange={(event) => setPlanField('emotionalArc', event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Số từ dự kiến</span>
                        <input
                          required
                          min={100}
                          max={50_000}
                          type="number"
                          value={planDraft.estimatedWordCount}
                          onChange={(event) =>
                            setPlanField('estimatedWordCount', Number(event.target.value))
                          }
                        />
                      </label>
                      <div className="actions">
                        <button type="submit">Lưu revision dàn ý</button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setPlanDraft(null)}
                        >
                          Hủy
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div>
                        <strong>
                          {item.chapterNumber}. {item.title}
                        </strong>
                        <p>{item.summary}</p>
                        <small>
                          {item.estimatedWordCount} từ · {item.emotionalArc} · {state}
                        </small>
                      </div>
                      <div className="actions">
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setPlanDraft(item)}
                        >
                          Sửa dàn ý
                        </button>
                        <button
                          className="secondary"
                          disabled={job?.status === 'PENDING' || job?.status === 'RUNNING'}
                          onClick={() => void generatePlanItem(item.id)}
                        >
                          {job?.status === 'FAILED'
                            ? 'Thử lại'
                            : existingChapter?.origin === 'MANUAL'
                              ? 'Xác nhận tạo lại'
                              : 'Tạo chương'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {story?.summaries.length ? (
        <section className="story-output">
          <div className="section-head">
            <h4>Tóm tắt và cảnh báo</h4>
            <span className="muted">{story.summaries.length} chương có tóm tắt</span>
          </div>
          {story.summaries.map((item) => (
            <article className="summary-row" key={item.id}>
              <div>
                <strong>
                  Chương {item.chapterId === activeChapterId ? 'đang chọn' : item.chapterId}
                </strong>
                <p>{item.summary.recap}</p>
              </div>
              {item.events.length > 0 && (
                <div className="summary-details">
                  <strong>Sự kiện:</strong>
                  <ul>
                    {item.events.map((event) => (
                      <li key={`${event.description}-${event.importance}`}>
                        {event.description} · {event.importance}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.threadTransitions.length > 0 && (
                <div className="summary-details">
                  <strong>Chuyển trạng thái tuyến truyện:</strong>
                  <ul>
                    {item.threadTransitions.map((transition) => (
                      <li key={`${transition.threadId}-${transition.status}`}>
                        {transition.threadId}: {transition.status} · {transition.note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.warnings.length > 0 && (
                <div className="warning-list">
                  {item.warnings.map((warning) => (
                    <span key={warning}>Cảnh báo: {warning}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      ) : (
        <div className="story-empty">
          <strong>Chưa có đầu ra Story</strong>
          <span>Lưu cài đặt rồi tạo blueprint để bắt đầu quy trình duyệt.</span>
        </div>
      )}
    </div>
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
