import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_OMP_MODEL } from '@studio/shared';

import type {
  ChapterDto,
  ChapterPlanItem,
  Health,
  JobDto,
  ProjectDto,
  RenderConfig,
  StatusSummary,
  StoryArc,
  StoryBlueprint,
  StoryGenerationBatch,
  StoryGenerationBatchItem,
  StoryPlanWindowResult,
  StoryPlanWindowSummary,
  StorySettings,
  StorySettingsDto,
  StorySnapshotDto,
  StoryUsageSummary,
  VisualStyleSettingsDto,
  SceneDto,
  LocationDto,
  CharacterVisualProfileDto,
  LocationVisualProfileDto,
  VisualObjectProfileDto,
  VisualPromptPackageDto,
  SceneObjectResolution,
} from '@studio/shared';
import './styles.css';
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const normalizeVisualObjectKey = (value: string): string =>
  value
    .trim()
    .replace(/\s+/gu, ' ')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
type ProjectDetail = { project: ProjectDto; chapters?: ChapterDto[] };
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
    model: DEFAULT_OMP_MODEL,
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
type ChapterStatusFilter = '' | 'FAILED' | 'PENDING' | 'CONTINUITY_STALE' | 'WARN';
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
  generateArcs: (projectId: string) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/story/arcs/generate`, {
      method: 'POST',
    }),
  updateArc: (projectId: string, arc: StoryArc) =>
    api<StoryArc>(`/api/projects/${projectId}/story/arcs/${arc.id}`, {
      method: 'PUT',
      body: JSON.stringify(arc),
    }),
  updatePlanWindow: (projectId: string, window: StoryPlanWindowResult) =>
    api<StoryPlanWindowResult>(
      `/api/projects/${projectId}/story/plan-windows/${window.window.id}`,
      {
        method: 'PUT',
        body: JSON.stringify(window),
      },
    ),
  getPlanWindow: (projectId: string, windowId: string) =>
    api<StoryPlanWindowResult>(`/api/projects/${projectId}/story/plan-windows/${windowId}`),
  generatePlanWindow: (
    projectId: string,
    input: { arcId: string; startChapter: number; endChapter: number },
  ) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/story/plan-windows/generate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  generateBatch: (
    projectId: string,
    input: {
      mode: 'NEXT' | 'RANGE' | 'UNTIL_END';
      count?: number;
      startChapter?: number;
      endChapter?: number;
    },
  ) =>
    api<{ batch: StoryGenerationBatch; executionId: string; jobIds: string[] }>(
      `/api/projects/${projectId}/story/batches`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  batchItems: (projectId: string, batchId: string) =>
    api<StoryGenerationBatchItem[]>(`/api/projects/${projectId}/story/batches/${batchId}/items`),
  retryBatchItem: (projectId: string, batchId: string, chapterNumber: number) =>
    api<StoryJobScheduleDto>(
      `/api/projects/${projectId}/story/batches/${batchId}/items/${chapterNumber}/retry`,
      { method: 'POST' },
    ),
  skipBatchItem: (projectId: string, batchId: string, chapterNumber: number, reason: string) =>
    api<StoryGenerationBatchItem>(
      `/api/projects/${projectId}/story/batches/${batchId}/items/${chapterNumber}/skip`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
  cancelBatch: (projectId: string, batchId: string) =>
    api<StoryGenerationBatch>(`/api/projects/${projectId}/story/batches/${batchId}/cancel`, {
      method: 'POST',
    }),
  analyzeChapter: (chapterId: string) =>
    api<StoryJobScheduleDto>(`/api/chapters/${chapterId}/story/analyze`, { method: 'POST' }),
  checkContinuity: (chapterId: string) =>
    api<StoryJobScheduleDto>(`/api/chapters/${chapterId}/story/continuity`, { method: 'POST' }),
  acceptAnalysis: (chapterId: string, checkId: string) =>
    api(`/api/chapters/${chapterId}/story/continuity/${checkId}/accept`, { method: 'POST' }),
  rebuildContinuity: (projectId: string, fromChapter: number) =>
    api(`/api/projects/${projectId}/story/rebuild-continuity`, {
      method: 'POST',
      body: JSON.stringify({ fromChapter }),
    }),
  keepStale: (projectId: string, fromChapter: number) =>
    api<{ disposition: 'KEEP_STALE'; fromChapter: number; updated: number }>(
      `/api/projects/${projectId}/story/continuity/keep-stale`,
      {
        method: 'POST',
        body: JSON.stringify({ fromChapter }),
      },
    ),
  compactSummary: (projectId: string) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/story/summary/compact`, {
      method: 'POST',
    }),
};

type SceneChapterSummary = {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterRevision: number;
  planRevision: number | null;
  planStatus: 'CURRENT' | 'STALE' | 'INVALIDATED' | null;
  sceneCount: number;
  stalePromptCount: number;
};
const sceneApi = {
  chapters: (projectId: string, offset = 0) =>
    api<SceneChapterSummary[]>(`/api/projects/${projectId}/scenes?limit=25&offset=${offset}`),
  list: (projectId: string, chapterId: string) =>
    api<SceneDto[]>(`/api/projects/${projectId}/chapters/${chapterId}/scenes?excerpt=false`),
  get: (projectId: string, sceneId: string) =>
    api<SceneDto>(`/api/projects/${projectId}/scenes/${sceneId}`),
  generate: (projectId: string, chapterId: string, input: Record<string, unknown>) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/chapters/${chapterId}/scenes/generate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  regenerate: (projectId: string, sceneId: string, input: Record<string, unknown>) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/scenes/${sceneId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  refreshPrompt: (projectId: string, sceneId: string, input: Record<string, unknown>) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/scenes/${sceneId}/prompt`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (projectId: string, sceneId: string, input: Record<string, unknown>) =>
    api<SceneDto>(`/api/projects/${projectId}/scenes/${sceneId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  batch: (projectId: string, input: Record<string, unknown>) =>
    api<{ executionId: string; jobIds: string[]; skippedChapterIds: string[] }>(
      `/api/projects/${projectId}/scenes/batch`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  style: (projectId: string) =>
    api<VisualStyleSettingsDto | null>(`/api/projects/${projectId}/visual-style`),
  saveStyle: (projectId: string, input: Record<string, unknown>) =>
    api<VisualStyleSettingsDto>(`/api/projects/${projectId}/visual-style`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  locations: (projectId: string) =>
    api<LocationDto[]>(`/api/projects/${projectId}/locations?limit=100&offset=0`),
  saveLocation: (projectId: string, input: Record<string, unknown>) =>
    api<LocationDto>(`/api/projects/${projectId}/locations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateLocation: (projectId: string, locationId: string, input: Record<string, unknown>) =>
    api<LocationDto>(`/api/projects/${projectId}/locations/${locationId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};
type VisualProfilePage<T> = { items: T[]; limit: number; offset: number };
const visualApi = {
  overview: (projectId: string) =>
    api<{
      style: VisualStyleSettingsDto | null;
      characters: VisualProfilePage<CharacterVisualProfileDto>;
      locations: VisualProfilePage<LocationVisualProfileDto>;
      objects: VisualProfilePage<VisualObjectProfileDto>;
    }>(`/api/projects/${projectId}/visual-bible?limit=100&offset=0`),
  characterRevisions: (projectId: string, characterId: string) =>
    api<CharacterVisualProfileDto[]>(
      `/api/projects/${projectId}/visual-bible/characters/${encodeURIComponent(characterId)}/revisions`,
    ),
  locationRevisions: (projectId: string, locationId: string) =>
    api<LocationVisualProfileDto[]>(
      `/api/projects/${projectId}/visual-bible/locations/${locationId}/revisions`,
    ),
  objectRevisions: (projectId: string, objectKey: string) =>
    api<VisualObjectProfileDto[]>(
      `/api/projects/${projectId}/visual-bible/objects/${encodeURIComponent(objectKey)}/revisions`,
    ),
  generate: (
    projectId: string,
    kind: 'CHARACTER' | 'LOCATION' | 'OBJECT',
    id: string,
    instructions = '',
  ) =>
    api<StoryJobScheduleDto>(
      `/api/projects/${projectId}/visual-bible/${kind.toLocaleLowerCase('en-US')}s/${encodeURIComponent(id)}/generate`,
      { method: 'POST', body: JSON.stringify({ instructions }) },
    ),
  update: (projectId: string, kind: string, id: string, body: Record<string, unknown>) =>
    api<CharacterVisualProfileDto | LocationVisualProfileDto | VisualObjectProfileDto>(
      `/api/projects/${projectId}/visual-bible/${kind}/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  approve: (
    projectId: string,
    kind: 'characters' | 'locations' | 'objects',
    id: string,
    revision: number,
  ) =>
    api<CharacterVisualProfileDto | LocationVisualProfileDto | VisualObjectProfileDto>(
      `/api/projects/${projectId}/visual-bible/${kind}/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify({ expectedRevision: revision }) },
    ),
  saveStyle: (projectId: string, style: VisualStyleSettingsDto) => {
    const payload = {
      styleName: style.styleName,
      styleDescription: style.styleDescription,
      medium: style.medium,
      realism: style.realism,
      overallStyle: style.overallStyle,
      colorPalette: style.colorPalette,
      cinematicStyle: style.cinematicStyle,
      cinematicLanguage: style.cinematicLanguage,
      lightingStyle: style.lightingStyle,
      textureStyle: style.textureStyle,
      environmentStyle: style.environmentStyle,
      characterRenderingStyle: style.characterRenderingStyle,
      cameraStyle: style.cameraStyle,
      compositionStyle: style.compositionStyle,
      moodKeywords: style.moodKeywords,
      aspectRatio: style.aspectRatio,
      promptSuffix: style.promptSuffix,
      positivePromptSuffix: style.positivePromptSuffix,
      negativePrompt: style.negativePrompt,
      referenceAssetIds: style.referenceAssetIds,
      expectedRevision: style.revision,
    };
    return api<VisualStyleSettingsDto>(`/api/projects/${projectId}/visual-style`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  preset: (projectId: string, preset: string) =>
    api<VisualStyleSettingsDto>(`/api/projects/${projectId}/visual-bible/style/preset`, {
      method: 'POST',
      body: JSON.stringify({ preset }),
    }),
  scenePackage: (projectId: string, sceneId: string) =>
    api<VisualPromptPackageDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/visual-prompt-package`,
    ),
  rebuildScenePackage: (projectId: string, sceneId: string) =>
    api<StoryJobScheduleDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/visual-prompt-package/rebuild`,
      { method: 'POST' },
    ),
  refine: (projectId: string, packageId: string, instructions: string, revision: number) =>
    api<StoryJobScheduleDto>(
      `/api/projects/${projectId}/visual-prompt-packages/${packageId}/refine`,
      {
        method: 'POST',
        body: JSON.stringify({ instructions, expectedPackageRevision: revision }),
      },
    ),
  resolutions: (projectId: string, sceneId: string) =>
    api<SceneObjectResolution[]>(
      `/api/projects/${projectId}/scenes/${sceneId}/visual-object-resolutions`,
    ),
  saveResolution: (
    projectId: string,
    sceneId: string,
    sourceLabel: string,
    visualObjectProfileId: string | null,
  ) =>
    api<SceneObjectResolution>(
      `/api/projects/${projectId}/scenes/${sceneId}/visual-object-resolutions/${encodeURIComponent(sourceLabel)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ visualObjectProfileId }),
      },
    ),
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
  const [chapterOffset, setChapterOffset] = useState(0);
  const [chapterSearch, setChapterSearch] = useState('');
  const [chapterStatus, setChapterStatus] = useState<ChapterStatusFilter>('');
  const chapterPageSize = 25;

  const refresh = async (): Promise<void> => {
    try {
      const [nextHealth, nextProjects] = await Promise.all([
        api<Health>('/api/health'),
        api<ProjectDto[]>('/api/projects'),
      ]);
      setHealth(nextHealth);
      setProjects(nextProjects);
      if (selected) {
        const chapterQuery = new URLSearchParams({
          limit: String(chapterPageSize),
          offset: String(chapterOffset),
        });
        if (chapterSearch.trim()) chapterQuery.set('search', chapterSearch.trim());
        if (chapterStatus) chapterQuery.set('status', chapterStatus);
        const [detail, nextChapters] = await Promise.all([
          api<ProjectDetail>(`/api/projects/${selected.id}?includeChapters=false`),
          api<ChapterDto[]>(`/api/projects/${selected.id}/chapters?${chapterQuery.toString()}`),
        ]);
        setSelected(detail.project);
        setChapters(nextChapters);
        setStory(await storyApi.snapshot(selected.id));
        const chapterId =
          activeChapterId && nextChapters.some((chapter) => chapter.id === activeChapterId)
            ? activeChapterId
            : nextChapters[0]?.id;
        setActiveChapterId(chapterId ?? null);
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
  }, [selected?.id, jobs.length, activeChapterId, chapterOffset, chapterSearch, chapterStatus]);

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
    const query = new URLSearchParams({ limit: '25', offset: '0' });
    const [detail, firstPage] = await Promise.all([
      api<ProjectDetail>(`/api/projects/${project.id}?includeChapters=false`),
      api<ChapterDto[]>(`/api/projects/${project.id}/chapters?${query.toString()}`),
    ]);
    setSelected(detail.project);
    setChapters(firstPage);
    setChapterOffset(0);
    setChapterSearch('');
    setActiveChapterId(firstPage[0]?.id ?? null);
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
  const generateStoryChapter = async (chapter: ChapterDto): Promise<void> => {
    if (!selected || !story || !chapter.storyPlanItemId) return;
    if (
      chapter.origin === 'MANUAL' &&
      !window.confirm(
        'Chương này đã được sửa thủ công. Xác nhận yêu cầu tạo lại để kiểm tra xung đột?',
      )
    )
      return;
    try {
      await storyApi.generate(
        `/api/projects/${selected.id}/story/chapters/${chapter.storyPlanItemId}/generate-v2`,
        {
          expectedPlanRevision: story.plan?.revision ?? null,
          expectedChapterRevision: chapter.revision,
        },
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo chương Story');
    }
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
                {['Story', 'Scenes', 'Visual Bible', 'Audio', 'Video', 'Render'].map((item) => (
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
                <ChapterTable
                  chapters={chapters}
                  activeChapterId={activeChapter?.id ?? null}
                  offset={chapterOffset}
                  pageSize={chapterPageSize}
                  search={chapterSearch}
                  status={chapterStatus}
                  onStatus={(value) => {
                    setChapterStatus(value);
                    setChapterOffset(0);
                  }}
                  onSearch={(value) => {
                    setChapterSearch(value);
                    setChapterOffset(0);
                  }}
                  onPageChange={setChapterOffset}
                  onSelect={setActiveChapterId}
                  onEdit={(chapterId, patch) =>
                    setChapters((items) =>
                      items.map((item) => (item.id === chapterId ? { ...item, ...patch } : item)),
                    )
                  }
                  onSave={(chapter) =>
                    void saveChapter(chapter).catch((cause) =>
                      setError(cause instanceof Error ? cause.message : 'Không thể lưu chương'),
                    )
                  }
                  onSummary={(chapter) =>
                    void generateSummary(chapter).catch((cause) =>
                      setError(cause instanceof Error ? cause.message : 'Không thể tạo tóm tắt'),
                    )
                  }
                  onAdd={() => void addChapter()}
                  onGenerate={(chapter) => void generateStoryChapter(chapter)}
                />
              </>
            )}
            {tab === 'Scenes' && (
              <ScenesWorkspace
                projectId={selected.id}
                activeChapterId={activeChapter?.id ?? null}
                onChanged={() => void refresh()}
                onError={setError}
              />
            )}
            {tab === 'Visual Bible' && (
              <VisualBibleWorkspace
                projectId={selected.id}
                story={story}
                activeChapterId={activeChapter?.id ?? null}
                onError={setError}
                onChanged={() => void refresh()}
              />
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

type VisualBibleProps = {
  projectId: string;
  story: StorySnapshotDto | null;
  activeChapterId: string | null;
  onError: (message: string) => void;
  onChanged: () => void;
};
type VisualProfileRecord =
  CharacterVisualProfileDto | LocationVisualProfileDto | VisualObjectProfileDto;

function VisualBibleWorkspace({
  projectId,
  story,
  activeChapterId,
  onError,
  onChanged,
}: VisualBibleProps) {
  const [overview, setOverview] = useState<{
    style: VisualStyleSettingsDto | null;
    characters: VisualProfilePage<CharacterVisualProfileDto>;
    locations: VisualProfilePage<LocationVisualProfileDto>;
    objects: VisualProfilePage<VisualObjectProfileDto>;
  } | null>(null);
  const [profileCandidates, setProfileCandidates] = useState<Record<string, VisualProfileRecord>>(
    {},
  );
  const [styleDraft, setStyleDraft] = useState<VisualStyleSettingsDto | null>(null);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [sceneList, setSceneList] = useState<SceneDto[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [scenePackage, setScenePackage] = useState<VisualPromptPackageDto | null>(null);
  const [objectResolutions, setObjectResolutions] = useState<SceneObjectResolution[]>([]);
  const [refinement, setRefinement] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (): Promise<void> => {
    try {
      const [nextOverview, nextLocations] = await Promise.all([
        visualApi.overview(projectId),
        sceneApi.locations(projectId).catch(() => []),
      ]);
      setOverview(nextOverview);
      setStyleDraft(nextOverview.style);
      setLocations(nextLocations);
      let nextScenes: SceneDto[] = [];
      if (activeChapterId) {
        nextScenes = await sceneApi.list(projectId, activeChapterId);
        setSceneList(nextScenes);
        const nextSceneId =
          selectedSceneId && nextScenes.some((scene) => scene.id === selectedSceneId)
            ? selectedSceneId
            : (nextScenes[0]?.id ?? null);
        setSelectedSceneId(nextSceneId);
        if (nextSceneId) {
          const [nextPackage, nextResolutions] = await Promise.all([
            visualApi.scenePackage(projectId, nextSceneId).catch(() => null),
            visualApi.resolutions(projectId, nextSceneId).catch(() => []),
          ]);
          setScenePackage(nextPackage);
          setObjectResolutions(nextResolutions);
        } else {
          setScenePackage(null);
          setObjectResolutions([]);
        }
      } else {
        setSceneList([]);
        setSelectedSceneId(null);
        setScenePackage(null);
        setObjectResolutions([]);
      }
      const objectKeys = new Set([
        ...nextOverview.objects.items.map((profile) => profile.objectKey),
        ...nextScenes
          .flatMap((scene) => scene.importantObjects.map(normalizeVisualObjectKey))
          .filter(Boolean),
      ]);
      const revisionResults = await Promise.all([
        ...(story?.blueprint?.blueprint.characters ?? []).map(
          async (character) =>
            [
              `CHARACTER:${character.id}`,
              (await visualApi.characterRevisions(projectId, character.id).catch(() => []))[0] ??
                null,
            ] as const,
        ),
        ...nextLocations.map(
          async (location) =>
            [
              `LOCATION:${location.id}`,
              (await visualApi.locationRevisions(projectId, location.id).catch(() => []))[0] ??
                null,
            ] as const,
        ),
        ...[...objectKeys].map(
          async (objectKey) =>
            [
              `OBJECT:${objectKey}`,
              (await visualApi.objectRevisions(projectId, objectKey).catch(() => []))[0] ?? null,
            ] as const,
        ),
      ]);
      const candidates: Record<string, VisualProfileRecord> = {};
      for (const [key, profile] of revisionResults) if (profile) candidates[key] = profile;
      setProfileCandidates(candidates);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tải Visual Bible');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [projectId, activeChapterId, selectedSceneId]);

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
      onChanged();
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Thao tác Visual Bible thất bại');
    }
  };
  const saveStyle = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (styleDraft) await run(() => visualApi.saveStyle(projectId, styleDraft));
  };
  const choosePreset = (preset: string): void => {
    void run(async () => {
      const saved = await visualApi.preset(projectId, preset);
      setStyleDraft(saved);
    });
  };
  if (loading && !overview)
    return (
      <div className="panel">
        <p>Đang tải Visual Bible...</p>
      </div>
    );
  const blueprintCharacters = story?.blueprint?.blueprint.characters ?? [];
  const characterProfiles = overview?.characters.items ?? [];
  const locationCandidates = locations.map((location) => ({
    id: location.id,
    title: location.name,
    profile:
      profileCandidates[`LOCATION:${location.id}`] ??
      overview?.locations.items.find((item) => item.locationId === location.id) ??
      null,
  }));
  const objectCandidates = Array.from(
    new Map(
      [
        ...(overview?.objects.items ?? []).map((profile) => {
          const candidate = profileCandidates[`OBJECT:${profile.objectKey}`];
          return [
            profile.objectKey,
            candidate && 'objectKey' in candidate ? candidate : profile,
          ] as const;
        }),
        ...sceneList.flatMap((scene) =>
          scene.importantObjects.map((name) => {
            const objectKey = normalizeVisualObjectKey(name);
            const candidate = profileCandidates[`OBJECT:${objectKey}`];
            const existing = overview?.objects.items.find(
              (profile) => profile.objectKey === objectKey,
            );
            return [
              objectKey,
              candidate && 'objectKey' in candidate
                ? candidate
                : (existing ??
                  ({
                    id: objectKey,
                    projectId,
                    objectKey,
                    name,
                    revision: 0,
                    status: 'DRAFT',
                    payload: {
                      name,
                      description: '',
                      referenceAssetIds: [],
                      shape: '',
                      distinctiveFeatures: [],
                      visualKeywords: [],
                      negativeTraits: [],
                      styleNotes: '',
                      materials: [],
                      colors: [],
                      condition: '',
                    },
                    promptFragment: '',
                    inputFingerprint: '',
                    generationId: null,
                    rowVersion: 0,
                    createdAt: '',
                    updatedAt: '',
                  } satisfies VisualObjectProfileDto)),
            ] as const;
          }),
        ),
      ].filter(([key]) => key.length > 0),
    ).values(),
  );
  const approvedObjectProfiles = Array.from(
    new Map(
      [
        ...(overview?.objects.items ?? []).filter((profile) => profile.status === 'APPROVED'),
        ...Array.from(objectCandidates).filter((profile) => profile.status === 'APPROVED'),
      ].map((profile) => [profile.id, profile] as const),
    ).values(),
  );
  return (
    <div className="visual-bible">
      <div className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">VISUAL CONSISTENCY</p>
            <h3>Visual Bible</h3>
            <p className="muted">
              Hồ sơ hình ảnh là bản nháp trước, chỉ hồ sơ được duyệt mới trở thành ràng buộc chính
              thức.
            </p>
          </div>
          <span className="status-chip status-current">
            {overview?.style ? `Style v${overview.style.revision}` : 'Chưa có Style Bible'}
          </span>
        </div>
        <div className="actions">
          {[
            'CINEMATIC_REALISTIC',
            'ANIME',
            'CHINESE_FANTASY_PAINTING',
            'STORYBOOK',
            '3D_ANIMATION',
          ].map((preset) => (
            <button className="secondary" key={preset} onClick={() => choosePreset(preset)}>
              {preset.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
        {styleDraft && (
          <form className="scene-style" onSubmit={(event) => void saveStyle(event)}>
            <div className="scene-form-grid">
              {[
                ['styleName', 'Tên Style Bible'],
                ['styleDescription', 'Mô tả phong cách'],
                ['medium', 'Chất liệu'],
                ['realism', 'Độ chân thực'],
                ['overallStyle', 'Ngôn ngữ tổng thể'],
                ['colorPalette', 'Bảng màu'],
                ['cinematicStyle', 'Phong cách điện ảnh'],
                ['cinematicLanguage', 'Ngôn ngữ điện ảnh'],
                ['lightingStyle', 'Phong cách ánh sáng'],
                ['textureStyle', 'Kết cấu'],
                ['environmentStyle', 'Phong cách môi trường'],
                ['characterRenderingStyle', 'Cách dựng nhân vật'],
                ['cameraStyle', 'Phong cách camera'],
                ['compositionStyle', 'Phong cách bố cục'],
                ['aspectRatio', 'Tỷ lệ khung hình'],
                ['positivePromptSuffix', 'Hậu tố tích cực'],
                ['negativePrompt', 'Điều cần tránh'],
              ].map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    value={String(styleDraft[key as keyof VisualStyleSettingsDto] ?? '')}
                    onChange={(event) =>
                      setStyleDraft((current) =>
                        current ? { ...current, [key]: event.target.value } : current,
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <button type="submit">Lưu Style Bible</button>
          </form>
        )}
      </div>
      <div className="visual-profile-grid">
        <VisualProfileCard
          title="Nhân vật"
          candidates={blueprintCharacters.map((character) => ({
            id: character.id,
            title: character.name,
            profile:
              profileCandidates[`CHARACTER:${character.id}`] ??
              characterProfiles.find((item) => item.characterId === character.id) ??
              null,
          }))}
          onGenerate={(id, instructions) =>
            run(() => visualApi.generate(projectId, 'CHARACTER', id, instructions))
          }
          onSave={(id, profile) =>
            run(() => visualApi.update(projectId, 'characters', id, profile))
          }
          onApprove={(id, revision) =>
            run(() => visualApi.approve(projectId, 'characters', id, revision))
          }
        />
        <VisualProfileCard
          title="Địa điểm"
          candidates={locationCandidates}
          onGenerate={(id, instructions) =>
            run(() => visualApi.generate(projectId, 'LOCATION', id, instructions))
          }
          onSave={(id, profile) => run(() => visualApi.update(projectId, 'locations', id, profile))}
          onApprove={(id, revision) =>
            run(() => visualApi.approve(projectId, 'locations', id, revision))
          }
        />
        <VisualProfileCard
          title="Vật thể"
          candidates={Array.from(objectCandidates).map((profile) => ({
            id: profile.objectKey,
            title: profile.name,
            profile: profile.revision > 0 ? profile : null,
          }))}
          onGenerate={(id, instructions) =>
            run(() => visualApi.generate(projectId, 'OBJECT', id, instructions))
          }
          onSave={(id, profile) => run(() => visualApi.update(projectId, 'objects', id, profile))}
          onApprove={(id, revision) =>
            run(() => visualApi.approve(projectId, 'objects', id, revision))
          }
        />
      </div>
      <div className="panel">
        <div className="section-head">
          <div>
            <h3>Visual Prompt Package</h3>
            <p className="muted">
              Prompt deterministic của scene, có thể rebuild mà không chạm vào narration hay render.
            </p>
          </div>
          <select
            value={selectedSceneId ?? ''}
            onChange={(event) => {
              const sceneId = event.target.value || null;
              setSelectedSceneId(sceneId);
              if (sceneId) {
                void Promise.all([
                  visualApi.scenePackage(projectId, sceneId).catch(() => null),
                  visualApi.resolutions(projectId, sceneId).catch(() => []),
                ]).then(([nextPackage, nextResolutions]) => {
                  setScenePackage(nextPackage);
                  setObjectResolutions(nextResolutions);
                });
              } else {
                setScenePackage(null);
                setObjectResolutions([]);
              }
            }}
          >
            <option value="">Chọn scene</option>
            {sceneList.map((scene) => (
              <option key={scene.id} value={scene.id}>
                Scene {scene.sceneNumber}: {scene.title}
              </option>
            ))}
          </select>
        </div>
        {selectedSceneId && (
          <div className="actions">
            <button
              onClick={() =>
                void run(() => visualApi.rebuildScenePackage(projectId, selectedSceneId))
              }
            >
              Rebuild package
            </button>
            {scenePackage && (
              <button
                className="secondary"
                onClick={() => {
                  const instructions = window.prompt('Yêu cầu refine prompt', refinement);
                  if (instructions !== null) {
                    setRefinement(instructions);
                    void run(() =>
                      visualApi.refine(
                        projectId,
                        scenePackage.id,
                        instructions,
                        scenePackage.revision,
                      ),
                    );
                  }
                }}
              >
                Refine tùy chọn
              </button>
            )}
          </div>
        )}
        {scenePackage ? (
          <div className="prompt-package">
            <div className="status-grid">
              <span>Trạng thái: {scenePackage.status}</span>
              <span>Consistency: {scenePackage.payload.consistencyStatus}</span>
              <span>Revision: {scenePackage.revision}</span>
            </div>
            <label className="field field-wide">
              <span>Prompt canonical</span>
              <textarea readOnly value={scenePackage.payload.fullPrompt} />
            </label>
            {scenePackage.payload.refinedPrompt && (
              <label className="field field-wide">
                <span>Prompt refined</span>
                <textarea readOnly value={scenePackage.payload.refinedPrompt} />
              </label>
            )}
            <p className="muted">Negative: {scenePackage.payload.negativePrompt ?? 'Không có'}</p>
            {scenePackage.payload.objects.length > 0 && (
              <div className="resolution-controls">
                <strong>Liên kết vật thể lặp lại</strong>
                {scenePackage.payload.objects.map((object) => {
                  const resolution = objectResolutions.find(
                    (item) => item.sourceLabel === object.sourceLabel,
                  );
                  return (
                    <label className="field" key={object.sourceLabel}>
                      <span>{object.sourceLabel}</span>
                      <select
                        value={
                          resolution
                            ? (resolution.visualObjectProfileId ?? '')
                            : (object.profileId ?? '')
                        }
                        onChange={(event) => {
                          void run(async () => {
                            await visualApi.saveResolution(
                              projectId,
                              selectedSceneId!,
                              object.sourceLabel,
                              event.target.value || null,
                            );
                            await visualApi.rebuildScenePackage(projectId, selectedSceneId!);
                          });
                        }}
                      >
                        <option value="">Chưa liên kết</option>
                        {approvedObjectProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name} (v{profile.revision})
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
            {scenePackage.payload.consistencyIssues.length > 0 && (
              <ul className="warning-list">
                {scenePackage.payload.consistencyIssues.map((issue, index) => (
                  <li key={`${issue.type}-${index}`}>
                    {issue.severity}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="muted">
            Chưa có package cho scene này. Rebuild để tạo prompt deterministic.
          </p>
        )}
      </div>
    </div>
  );
}

function VisualProfileCard({
  title,
  candidates,
  onGenerate,
  onSave,
  onApprove,
}: {
  title: string;
  candidates: Array<{ id: string; title: string; profile: VisualProfileRecord | null }>;
  onGenerate: (id: string, instructions: string) => Promise<void>;
  onSave: (id: string, profile: Record<string, unknown>) => Promise<void>;
  onApprove: (id: string, revision: number) => Promise<void>;
}) {
  return (
    <div className="panel visual-profile-panel">
      <div className="section-head">
        <div>
          <h3>{title}</h3>
          <p className="muted">{candidates.length} mục trong phạm vi hiện tại</p>
        </div>
      </div>
      {candidates.length === 0 ? (
        <p className="muted">Chưa có dữ liệu nguồn để tạo hồ sơ.</p>
      ) : (
        candidates.map((candidate) => (
          <VisualProfileEditor
            key={candidate.id}
            id={candidate.id}
            title={candidate.title}
            profile={candidate.profile}
            onGenerate={onGenerate}
            onSave={onSave}
            onApprove={onApprove}
          />
        ))
      )}
    </div>
  );
}

function VisualProfileEditor({
  id,
  title,
  profile,
  onGenerate,
  onSave,
  onApprove,
}: {
  id: string;
  title: string;
  profile: VisualProfileRecord | null;
  onGenerate: (id: string, instructions: string) => Promise<void>;
  onSave: (id: string, profile: Record<string, unknown>) => Promise<void>;
  onApprove: (id: string, revision: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(JSON.stringify(profile?.payload ?? {}, null, 2));
  const [instructions, setInstructions] = useState('');
  useEffect(() => {
    setDraft(JSON.stringify(profile?.payload ?? {}, null, 2));
  }, [profile?.id, profile?.revision]);
  const save = (): void => {
    try {
      const payload = JSON.parse(draft) as Record<string, unknown>;
      void onSave(id, {
        expectedRevision: profile?.revision,
        payload,
      });
    } catch {
      window.alert('Payload phải là JSON hợp lệ.');
    }
  };
  return (
    <article className="visual-profile-editor">
      <div className="section-head">
        <strong>{title}</strong>
        <span
          className={`status-chip ${profile?.status === 'APPROVED' ? 'status-current' : 'status-warn'}`}
        >
          {profile ? `${profile.status} v${profile.revision}` : 'MISSING'}
        </span>
      </div>
      <textarea
        aria-label={`Payload ${title}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Tạo candidate hoặc nhập payload JSON bounded."
      />
      {profile && (
        <div className="profile-metadata">
          <span>Prompt fragment: {profile.promptFragment || 'Chưa có prompt fragment'}</span>
          <span>
            References:{' '}
            {profile.payload.referenceAssetIds.length
              ? profile.payload.referenceAssetIds.join(', ')
              : 'Không có'}
          </span>
        </div>
      )}
      <label className="field">
        <span>Yêu cầu tạo lại (tuỳ chọn)</span>
        <input
          aria-label={`Yêu cầu tạo lại ${title}`}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Ví dụ: đổi bảng màu, giữ nguyên nhận diện"
        />
      </label>
      <div className="actions">
        <button className="secondary" onClick={() => void onGenerate(id, instructions)}>
          {profile ? 'Tạo lại candidate' : 'Tạo candidate'}
        </button>
        {profile && <button onClick={save}>Lưu bản chỉnh sửa</button>}
        {profile?.status === 'DRAFT' && (
          <button className="secondary" onClick={() => void onApprove(id, profile.revision)}>
            Duyệt hồ sơ
          </button>
        )}
      </div>
    </article>
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
  const setGenerationField = <K extends keyof StorySettings['generation']>(
    key: K,
    value: StorySettings['generation'][K],
  ): void => {
    setDraft((current) => ({
      ...current,
      generation: { ...current.generation, [key]: value },
    }));
  };
  const chapterJobFor = (planItemId: string) =>
    story.jobs.find(
      (job) =>
        (job.type === 'GENERATE_CHAPTER_V2' || job.type === 'GENERATE_CHAPTER') &&
        job.entityId === planItemId,
    );
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
          `/api/projects/${projectId}/story/chapters/${planItemId}/generate-v2`,
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
      <LongStoryDashboard
        projectId={projectId}
        story={story}
        chapters={chapters}
        activeChapterId={activeChapterId}
        onChanged={onChanged}
        onError={onError}
      />
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
            <span>Cửa sổ lập kế hoạch</span>
            <input
              type="number"
              min={10}
              max={25}
              value={draft.generation.planningWindow ?? 20}
              onChange={(event) => setGenerationField('planningWindow', Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Batch tối đa</span>
            <input
              type="number"
              min={1}
              max={200}
              value={draft.generation.maxChaptersPerBatch ?? 25}
              onChange={(event) =>
                setGenerationField('maxChaptersPerBatch', Number(event.target.value))
              }
            />
          </label>
          <label className="field">
            <span>Số lần thử lại</span>
            <input
              type="number"
              min={0}
              max={10}
              value={draft.generation.maxRetries ?? 3}
              onChange={(event) => setGenerationField('maxRetries', Number(event.target.value))}
            />
          </label>
          <label className="field checkbox-field">
            <span>Continuity tự động</span>
            <input
              type="checkbox"
              checked={draft.generation.continuityChecksEnabled ?? false}
              onChange={(event) =>
                setGenerationField('continuityChecksEnabled', event.target.checked)
              }
            />
          </label>
          <label className="field">
            <span>Ngân sách USD (trống = không giới hạn)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.generation.budgetUsd ?? ''}
              onChange={(event) =>
                setGenerationField(
                  'budgetUsd',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
          </label>
          <label className="field">
            <span>Token tối đa mỗi lượt</span>
            <input
              type="number"
              min={1}
              max={1_000_000}
              value={draft.generation.maxEstimatedTokensPerOperation ?? ''}
              onChange={(event) =>
                setGenerationField(
                  'maxEstimatedTokensPerOperation',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
          </label>
          <label className="field">
            <span>Model OMP mặc định</span>
            <input
              value={draft.generation.model ?? DEFAULT_OMP_MODEL}
              onChange={(event) =>
                setGenerationField('model', event.target.value.trim() || DEFAULT_OMP_MODEL)
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

type SceneStyleForm = {
  styleName: string;
  styleDescription: string;
  medium: string;
  realism: string;
  colorPalette: string;
  cinematicStyle: string;
  aspectRatio: string;
  promptSuffix: string;
};

const scenePurposeLabels: Record<SceneDto['purpose'], string> = {
  INTRODUCTION: 'Mở đầu',
  ESTABLISHING: 'Thiết lập không gian',
  DIALOGUE: 'Đối thoại',
  ACTION: 'Hành động',
  DISCOVERY: 'Khám phá',
  EMOTIONAL: 'Cảm xúc',
  TRANSITION: 'Chuyển cảnh',
  REVEAL: 'Tiết lộ',
  CLIMAX: 'Cao trào',
  ENDING_HOOK: 'Móc kết',
};
const sceneFramingLabels: Record<SceneDto['camera']['framing'], string> = {
  EXTREME_WIDE: 'Toàn cảnh rất rộng',
  WIDE: 'Toàn cảnh rộng',
  FULL: 'Toàn thân',
  MEDIUM: 'Trung cảnh',
  CLOSE_UP: 'Cận cảnh',
  EXTREME_CLOSE_UP: 'Đặc tả',
  OVER_THE_SHOULDER: 'Qua vai',
  POV: 'Góc nhìn nhân vật',
};
const sceneStatusLabels: Record<SceneDto['status'], string> = {
  CURRENT: 'Hiện hành',
  STALE: 'Lỗi thời',
  INVALIDATED: 'Đã vô hiệu',
};
const scenePromptStatusLabels: Record<SceneDto['promptStatus'], string> = {
  CURRENT: 'Hiện hành',
  STALE: 'Lỗi thời',
  MISSING: 'Chưa có',
};
const scenePurposeOptions = Object.keys(scenePurposeLabels) as Array<SceneDto['purpose']>;
const sceneFramingOptions = Object.keys(sceneFramingLabels) as Array<SceneDto['camera']['framing']>;

const defaultSceneStyleForm: SceneStyleForm = {
  styleName: 'Điện ảnh nhất quán',
  styleDescription: '',
  medium: 'Minh họa điện ảnh',
  realism: 'Tự nhiên',
  colorPalette: '',
  cinematicStyle: '',
  aspectRatio: '16:9',
  promptSuffix: '',
};

function ScenesWorkspace({
  projectId,
  activeChapterId,
  onChanged,
  onError,
}: {
  projectId: string;
  activeChapterId: string | null;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [sceneChapters, setSceneChapters] = useState<SceneChapterSummary[]>([]);
  const [chapterOffset, setChapterOffset] = useState(0);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(activeChapterId);
  const [sceneList, setSceneList] = useState<SceneDto[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SceneDto | null>(null);
  const [scenePackage, setScenePackage] = useState<VisualPromptPackageDto | null>(null);
  const [density, setDensity] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [targetMin, setTargetMin] = useState('');
  const [targetMax, setTargetMax] = useState('');
  const [style, setStyle] = useState<VisualStyleSettingsDto | null>(null);
  const [styleForm, setStyleForm] = useState<SceneStyleForm>(defaultSceneStyleForm);
  const [showStyle, setShowStyle] = useState(false);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [sceneFailedJob, setSceneFailedJob] = useState<JobDto | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sceneJobIds, setSceneJobIds] = useState<string[]>([]);

  const loadSceneChapters = async (): Promise<void> => {
    try {
      const next = await sceneApi.chapters(projectId, chapterOffset);
      setSceneChapters(next);
      setSelectedChapterId((current) => {
        if (activeChapterId && next.some((item) => item.chapterId === activeChapterId))
          return activeChapterId;
        if (current && next.some((item) => item.chapterId === current)) return current;
        return next[0]?.chapterId ?? null;
      });
      const nextStyle = await sceneApi.style(projectId);
      setStyle(nextStyle);
      if (nextStyle)
        setStyleForm({
          styleName: nextStyle.styleName,
          styleDescription: nextStyle.styleDescription,
          medium: nextStyle.medium,
          realism: nextStyle.realism,
          colorPalette: nextStyle.colorPalette,
          cinematicStyle: nextStyle.cinematicStyle,
          aspectRatio: nextStyle.aspectRatio,
          promptSuffix: nextStyle.promptSuffix,
        });
      setLocations(await sceneApi.locations(projectId));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu cảnh');
    } finally {
      setLoading(false);
    }
  };

  const loadScenes = async (): Promise<void> => {
    if (!selectedChapterId) {
      setSceneList([]);
      setSelectedSceneId(null);
      return;
    }
    try {
      const next = await sceneApi.list(projectId, selectedChapterId);
      setSceneList(next);
      setSelectedSceneId((current) =>
        current && next.some((scene) => scene.id === current) ? current : (next[0]?.id ?? null),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tải danh sách cảnh');
    }
  };

  useEffect(() => {
    setLoading(true);
    void loadSceneChapters();
  }, [projectId, chapterOffset]);
  useEffect(() => {
    void loadScenes();
  }, [projectId, selectedChapterId]);
  useEffect(() => {
    if (!selectedSceneId) {
      setDraft(null);
      setScenePackage(null);
      return;
    }
    const selectedScene = sceneList.find((scene) => scene.id === selectedSceneId);
    if (selectedScene) {
      void Promise.all([
        sceneApi.get(projectId, selectedScene.id),
        visualApi.scenePackage(projectId, selectedScene.id).catch(() => null),
      ])
        .then(([nextDraft, nextPackage]) => {
          setDraft(nextDraft);
          setScenePackage(nextPackage);
        })
        .catch((cause) =>
          onError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết cảnh'),
        );
    }
  }, [projectId, selectedSceneId, sceneList]);
  useEffect(() => {
    if (!sceneJobIds.length) return;
    let disposed = false;
    const poll = async (): Promise<void> => {
      try {
        const jobs = await Promise.all(
          sceneJobIds.map((jobId) => api<JobDto>(`/api/jobs/${jobId}`)),
        );
        const finished = jobs.some((job) =>
          ['COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED'].includes(job.status),
        );
        if (!disposed && finished) {
          setSceneJobIds((current) =>
            current.filter(
              (jobId) =>
                !jobs.some(
                  (job) =>
                    job.id === jobId &&
                    ['COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED'].includes(job.status),
                ),
            ),
          );
          await loadSceneChapters();
          await loadScenes();
          onChanged();
          const failed = jobs.find((job) => job.status === 'FAILED');
          if (failed) setSceneFailedJob(failed);
          if (failed?.error) onError(failed.error);
        }
      } catch (cause) {
        if (!disposed)
          onError(cause instanceof Error ? cause.message : 'Không thể theo dõi job Scene Engine');
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [projectId, sceneJobIds]);

  const chapter = sceneChapters.find((item) => item.chapterId === selectedChapterId);
  const sceneJobBody = (): Record<string, unknown> => {
    const min = Number(targetMin);
    const max = Number(targetMax);
    return {
      density,
      targetRange:
        Number.isInteger(min) && Number.isInteger(max) && min > 0 && max >= min
          ? { min, max }
          : null,
      expectedChapterRevision: chapter?.chapterRevision,
    };
  };
  const queueSceneJobs = (result: StoryJobScheduleDto): void => {
    const ids = [...(result.jobIds ?? []), ...(result.jobId ? [result.jobId] : [])];
    setSceneFailedJob(null);
    setSceneJobIds((current) => [...new Set([...current, ...ids])]);
  };
  const retrySceneJob = async (): Promise<void> => {
    if (!sceneFailedJob) return;
    try {
      await storyApi.retryJob(sceneFailedJob.id);
      setSceneFailedJob(null);
      setSceneJobIds((current) => [...new Set([...current, sceneFailedJob.id])]);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể thử lại job Scene Engine');
    }
  };
  const generateSelectedChapter = async (): Promise<void> => {
    if (!selectedChapterId) return;
    try {
      queueSceneJobs(await sceneApi.generate(projectId, selectedChapterId, sceneJobBody()));
      await loadSceneChapters();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo scene plan');
    }
  };
  const generateBatch = async (): Promise<void> => {
    if (!selectedBatchIds.length) {
      onError('Chọn ít nhất một chương để tạo scene plan.');
      return;
    }
    try {
      queueSceneJobs(
        await sceneApi.batch(projectId, {
          chapterIds: selectedBatchIds,
          density,
          targetRange: sceneJobBody().targetRange,
          onlyMissing: true,
        }),
      );
      await loadSceneChapters();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo scene plan theo lô');
    }
  };
  const saveStyle = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      const saved = await sceneApi.saveStyle(projectId, {
        ...styleForm,
        ...(style ? { expectedRevision: style.revision } : {}),
      });
      setStyle(saved);
      setShowStyle(false);
      await loadScenes();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu visual style');
    }
  };
  const createLocation = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!newLocationName.trim()) return;
    try {
      const created = await sceneApi.saveLocation(projectId, { name: newLocationName.trim() });
      setLocations((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setNewLocationName('');
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể thêm location');
    }
  };
  const saveScene = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!draft) return;
    try {
      const saved = await sceneApi.update(projectId, draft.id, {
        expectedRevision: draft.revision,
        title: draft.title,
        summary: draft.summary,
        purpose: draft.purpose,
        location: draft.location,
        timeOfDay: draft.timeOfDay,
        weather: draft.weather,
        mood: draft.mood,
        visualDescription: draft.visualDescription,
        camera: draft.camera,
        lighting: draft.lighting,
        colorMood: draft.colorMood,
        imagePrompt: draft.imagePrompt,
        negativePrompt: draft.negativePrompt,
        continuityNotes: draft.continuityNotes,
      });
      setDraft(saved);
      await loadScenes();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu scene');
    }
  };
  const regenerateScene = async (): Promise<void> => {
    if (!draft) return;
    try {
      queueSceneJobs(
        await sceneApi.regenerate(projectId, draft.id, {
          expectedRevision: draft.revision,
        }),
      );
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo lại scene');
    }
  };
  const refreshPrompt = async (): Promise<void> => {
    if (!draft) return;
    try {
      queueSceneJobs(
        await sceneApi.refreshPrompt(projectId, draft.id, {
          expectedRevision: draft.revision,
        }),
      );
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể làm mới prompt');
    }
  };
  const rebuildVisualPackage = async (): Promise<void> => {
    if (!draft) return;
    try {
      setScenePackage(null);
      queueSceneJobs(await visualApi.rebuildScenePackage(projectId, draft.id));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể rebuild Visual Prompt Package');
    }
  };
  const updateDraft = <K extends keyof SceneDto>(key: K, value: SceneDto[K]): void => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const updateCamera = <K extends keyof SceneDto['camera']>(
    key: K,
    value: SceneDto['camera'][K],
  ): void => {
    setDraft((current) =>
      current ? { ...current, camera: { ...current.camera, [key]: value } } : current,
    );
  };
  const pageSize = 25;
  const allCurrentPageSelected =
    sceneChapters.length > 0 &&
    sceneChapters.every((item) => selectedBatchIds.includes(item.chapterId));

  if (loading) {
    return (
      <section className="scene-workspace scene-loading">
        <strong>Đang tải Bộ máy cảnh...</strong>
        <span className="muted">Đang đọc kế hoạch cảnh và ngữ cảnh hình ảnh đã lưu.</span>
      </section>
    );
  }
  return (
    <section className="scene-workspace">
      <div className="scene-toolbar">
        <div>
          <p className="eyebrow">BỘ MÁY CẢNH</p>
          <h3>Chương → cảnh → prompt hình ảnh</h3>
          <p className="muted">
            Lập kế hoạch theo chương với khoảng nguồn UTF-16, cảnh báo liên tục và prompt có phiên
            bản.
          </p>
        </div>
        <div className="scene-toolbar-actions">
          <label>
            Mật độ
            <select
              value={density}
              onChange={(event) => setDensity(event.target.value as typeof density)}
            >
              <option value="LOW">Thưa</option>
              <option value="MEDIUM">Vừa</option>
              <option value="HIGH">Dày</option>
            </select>
          </label>
          <label>
            Khoảng cảnh
            <span className="range-fields">
              <input
                aria-label="Số cảnh tối thiểu"
                inputMode="numeric"
                placeholder="min"
                value={targetMin}
                onChange={(event) => setTargetMin(event.target.value)}
              />
              <input
                aria-label="Số cảnh tối đa"
                inputMode="numeric"
                placeholder="max"
                value={targetMax}
                onChange={(event) => setTargetMax(event.target.value)}
              />
            </span>
          </label>
          <button
            disabled={!selectedChapterId || sceneJobIds.length > 0}
            onClick={() => void generateSelectedChapter()}
          >
            {chapter?.sceneCount ? 'Tạo lại kế hoạch' : 'Tạo kế hoạch cảnh'}
          </button>
          <button className="secondary" onClick={() => setShowStyle((current) => !current)}>
            {showStyle ? 'Ẩn phong cách' : 'Phong cách hình ảnh'}
          </button>
        </div>
      </div>
      {sceneFailedJob && (
        <div className="scene-job-error" role="alert">
          <span>Tác vụ Bộ máy cảnh thất bại: {sceneFailedJob.error ?? 'Lỗi không xác định.'}</span>
          <button className="secondary" onClick={() => void retrySceneJob()}>
            Thử lại
          </button>
        </div>
      )}
      {sceneJobIds.length > 0 && (
        <div className="scene-job-status" role="status">
          Đang xử lý {sceneJobIds.length} tác vụ Bộ máy cảnh. Dữ liệu sẽ tự làm mới khi worker hoàn
          tất.
        </div>
      )}
      {showStyle && (
        <form className="scene-style panel" onSubmit={(event) => void saveStyle(event)}>
          <div className="section-head">
            <div>
              <h4>Phong cách hình ảnh hiện tại</h4>
              <p className="muted">
                Phong cách là bản sửa đổi độc lập; đổi phong cách chỉ làm prompt lỗi thời.
              </p>
            </div>
            {style && (
              <span className="status-chip status-current">Bản sửa đổi {style.revision}</span>
            )}
          </div>
          <div className="scene-form-grid">
            {(
              [
                ['styleName', 'Tên phong cách'],
                ['medium', 'Chất liệu'],
                ['realism', 'Độ chân thực'],
                ['colorPalette', 'Bảng màu'],
                ['cinematicStyle', 'Phong cách điện ảnh'],
                ['aspectRatio', 'Tỷ lệ khung hình'],
              ] as Array<[keyof SceneStyleForm, string]>
            ).map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  value={styleForm[key]}
                  onChange={(event) =>
                    setStyleForm((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </label>
            ))}
            <label className="field field-wide">
              <span>Mô tả phong cách</span>
              <textarea
                value={styleForm.styleDescription}
                onChange={(event) =>
                  setStyleForm((current) => ({ ...current, styleDescription: event.target.value }))
                }
              />
            </label>
            <label className="field field-wide">
              <span>Hậu tố prompt</span>
              <textarea
                value={styleForm.promptSuffix}
                onChange={(event) =>
                  setStyleForm((current) => ({ ...current, promptSuffix: event.target.value }))
                }
              />
            </label>
          </div>
          <button type="submit">Lưu phong cách hình ảnh</button>
        </form>
      )}
      <div className="scene-layout">
        <aside className="scene-chapter-list" aria-label="Danh sách chương cho Bộ máy cảnh">
          <div className="section-head">
            <div>
              <h4>Chương</h4>
              <p className="muted">Chọn chương để xem kế hoạch cảnh.</p>
            </div>
            <button
              className="secondary"
              disabled={chapterOffset === 0}
              onClick={() => setChapterOffset(Math.max(0, chapterOffset - pageSize))}
            >
              Trước
            </button>
          </div>
          {sceneChapters.map((item) => (
            <button
              className={`scene-chapter ${selectedChapterId === item.chapterId ? 'active' : ''}`}
              key={item.chapterId}
              onClick={() => setSelectedChapterId(item.chapterId)}
            >
              <span>Chương {item.chapterNumber}</span>
              <strong>{item.chapterTitle}</strong>
              <small>
                {item.sceneCount ? `${item.sceneCount} cảnh` : 'Chưa có kế hoạch'}
                {item.stalePromptCount ? ` · ${item.stalePromptCount} prompt lỗi thời` : ''}
              </small>
            </button>
          ))}
          <button
            className="secondary"
            disabled={sceneChapters.length < pageSize}
            onClick={() => setChapterOffset(chapterOffset + pageSize)}
          >
            Sau
          </button>
          <div className="batch-picker">
            <div className="section-head">
              <strong>Tạo theo lô</strong>
              <button
                className="secondary"
                disabled={!sceneChapters.length || sceneJobIds.length > 0}
                onClick={() =>
                  setSelectedBatchIds((current) => {
                    const pageIds = sceneChapters.map((item) => item.chapterId);
                    return allCurrentPageSelected
                      ? current.filter((id) => !pageIds.includes(id))
                      : [...new Set([...current, ...pageIds])];
                  })
                }
              >
                {allCurrentPageSelected ? 'Bỏ chọn trang' : 'Chọn trang'}
              </button>
            </div>
            {sceneChapters.map((item) => (
              <label key={`batch-${item.chapterId}`}>
                <input
                  type="checkbox"
                  checked={selectedBatchIds.includes(item.chapterId)}
                  onChange={(event) =>
                    setSelectedBatchIds((current) =>
                      event.target.checked
                        ? [...current, item.chapterId]
                        : current.filter((id) => id !== item.chapterId),
                    )
                  }
                />
                Chương {item.chapterNumber}
              </label>
            ))}
            <button
              disabled={!selectedBatchIds.length || sceneJobIds.length > 0}
              onClick={() => void generateBatch()}
            >
              Tạo kế hoạch cho các chương đã chọn
            </button>
          </div>
        </aside>
        <div className="scene-editor">
          <div className="section-head">
            <div>
              <h4>
                {chapter
                  ? `Chương ${chapter.chapterNumber}: ${chapter.chapterTitle}`
                  : 'Chưa chọn chương'}
              </h4>
              <p className="muted">
                {chapter?.planRevision
                  ? `Bản kế hoạch ${chapter.planRevision}`
                  : 'Chưa có kế hoạch'}
              </p>
            </div>
            <button className="secondary" onClick={() => void loadScenes()}>
              Làm mới
            </button>
          </div>
          <div className="scene-card-list">
            {sceneList.map((scene) => (
              <button
                className={`scene-card ${selectedSceneId === scene.id ? 'active' : ''}`}
                key={scene.id}
                onClick={() => setSelectedSceneId(scene.id)}
              >
                <span className="scene-number">
                  Cảnh {String(scene.sceneNumber).padStart(2, '0')}
                </span>
                <strong>{scene.title}</strong>
                <p>{scene.summary}</p>
                <div className="chip-row">
                  <span className="status-chip status-current">
                    {scenePurposeLabels[scene.purpose]}
                  </span>
                  <span className="status-chip">{scene.location ?? 'Chưa có địa điểm'}</span>
                  <span className={`status-chip status-${scene.promptStatus.toLowerCase()}`}>
                    Prompt {scenePromptStatusLabels[scene.promptStatus]}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {!sceneList.length && (
            <div className="scene-empty">
              <strong>Chương này chưa có kế hoạch cảnh.</strong>
              <span className="muted">
                Chọn mật độ rồi tạo kế hoạch. Văn bản chương và ngữ cảnh giới hạn sẽ được gửi qua
                OMP.
              </span>
              <button disabled={!selectedChapterId} onClick={() => void generateSelectedChapter()}>
                Tạo kế hoạch cảnh đầu tiên
              </button>
            </div>
          )}
          {draft && (
            <form className="scene-detail panel" onSubmit={(event) => void saveScene(event)}>
              <div className="section-head">
                <div>
                  <p className="eyebrow">CẢNH {String(draft.sceneNumber).padStart(2, '0')}</p>
                  <h4>{draft.title}</h4>
                </div>
                <div className="chip-row">
                  <span className={`status-chip status-${draft.status.toLowerCase()}`}>
                    {sceneStatusLabels[draft.status]}
                  </span>
                  <span className={`status-chip status-${draft.promptStatus.toLowerCase()}`}>
                    Prompt {scenePromptStatusLabels[draft.promptStatus]}
                  </span>
                  <span className="status-chip">Bản sửa đổi {draft.revision}</span>
                </div>
              </div>
              <div className="scene-metadata">
                <span>Mục đích: {scenePurposeLabels[draft.purpose]}</span>
                <span>
                  Khoảng nguồn UTF-16: {draft.sourceRange.start}-{draft.sourceRange.end}
                </span>
                <span>Bản kế hoạch: {draft.planRevision}</span>
              </div>
              <label className="field">
                <span>Đoạn trích nguồn (chỉ đọc)</span>
                <pre className="source-excerpt">
                  {draft.sourceExcerpt ?? 'Không có đoạn trích.'}
                </pre>
              </label>
              {draft.unresolvedReferences.length > 0 && (
                <div className="warning-list">
                  {draft.unresolvedReferences.map((reference) => (
                    <span key={reference}>Chưa resolve: {reference}</span>
                  ))}
                </div>
              )}
              {scenePackage && (
                <section className="visual-package-summary field-wide">
                  <div className="section-head">
                    <div>
                      <span className="field-label">Visual Prompt Package</span>
                      <p className="muted">
                        Prompt canonical/refined đọc từ gói đã lưu, không tạo lại Scene structure.
                      </p>
                    </div>
                    <div className="chip-row">
                      <span
                        className={`status-chip status-${scenePackage.payload.consistencyStatus.toLowerCase()}`}
                      >
                        {scenePackage.payload.consistencyStatus}
                      </span>
                      <span className="status-chip">
                        Package v{scenePackage.revision} · Scene v
                        {scenePackage.payload.sceneRevision}
                      </span>
                    </div>
                  </div>
                  <div className="scene-composition-grid">
                    <span>
                      <strong>Style Bible:</strong> v
                      {scenePackage.payload.styleRevision ?? 'chưa có'}
                    </span>
                    <span>
                      <strong>Phụ thuộc:</strong>{' '}
                      {scenePackage.payload.dependencies
                        .map((dependency) => `${dependency.kind} v${dependency.revision}`)
                        .join(' · ') || 'Không có'}
                    </span>
                    <span>
                      <strong>Canonical:</strong>{' '}
                      {scenePackage.payload.characters
                        .map(
                          (character) =>
                            `${character.displayName}: ${character.profileId ? 'đã duyệt' : 'thiếu'}`,
                        )
                        .join(' · ') || 'Không có nhân vật'}
                    </span>
                    <span>
                      <strong>State cảnh:</strong>{' '}
                      {scenePackage.payload.characters
                        .map(
                          (character) =>
                            `${character.displayName}: ${
                              [
                                character.sceneVisualState.expression,
                                character.sceneVisualState.pose,
                                character.sceneVisualState.action,
                              ]
                                .filter(Boolean)
                                .join(', ') || 'không có'
                            }`,
                        )
                        .join(' · ') || 'Không có state'}
                    </span>
                  </div>
                  <label className="field field-wide">
                    <span>
                      {scenePackage.payload.refinedPrompt ? 'Prompt refined' : 'Prompt canonical'}
                    </span>
                    <textarea
                      readOnly
                      value={scenePackage.payload.refinedPrompt ?? scenePackage.payload.fullPrompt}
                    />
                  </label>
                  <p className="muted">
                    Negative: {scenePackage.payload.negativePrompt ?? 'Không có'}
                  </p>
                  {scenePackage.payload.consistencyIssues.length > 0 && (
                    <ul className="warning-list">
                      {scenePackage.payload.consistencyIssues.map((issue, index) => (
                        <li key={`${issue.type}-${index}`}>
                          {issue.severity}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void rebuildVisualPackage()}
                  >
                    Rebuild Visual Prompt Package
                  </button>
                </section>
              )}
              {draft.characters.length > 0 && (
                <div className="scene-character-snapshots field-wide">
                  <span className="field-label">Nhân vật và trạng thái hình ảnh</span>
                  <div className="scene-character-grid">
                    {draft.characters.map((character) => (
                      <article
                        className="scene-character-snapshot"
                        key={`${character.displayName}-${character.characterId ?? 'unresolved'}`}
                      >
                        <strong>{character.displayName}</strong>
                        <span>{character.roleInScene || 'Vai trò chưa ghi'}</span>
                        <small>
                          {[
                            character.visualState.expression,
                            character.visualState.pose,
                            character.visualState.action,
                            character.visualState.clothing,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Chưa có trạng thái hình ảnh'}
                        </small>
                        <em>
                          {character.resolutionStatus === 'RESOLVED'
                            ? 'Đã nối nhân vật chuẩn'
                            : 'Cần duyệt nhân vật'}
                        </em>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <div className="scene-composition field-wide">
                <span className="field-label">Bố cục khung hình</span>
                <div className="scene-composition-grid">
                  <span>
                    <strong>Trọng tâm:</strong> {draft.composition.subjectFocus}
                  </span>
                  <span>
                    <strong>Tiền cảnh:</strong>{' '}
                    {draft.composition.foreground.join(', ') || 'Không có'}
                  </span>
                  <span>
                    <strong>Trung cảnh:</strong>{' '}
                    {draft.composition.midground.join(', ') || 'Không có'}
                  </span>
                  <span>
                    <strong>Hậu cảnh:</strong>{' '}
                    {draft.composition.background.join(', ') || 'Không có'}
                  </span>
                  {draft.composition.characterPositions.length > 0 && (
                    <span>
                      <strong>Vị trí nhân vật:</strong>{' '}
                      {draft.composition.characterPositions
                        .map((item) => `${item.displayName}: ${item.position}`)
                        .join(' · ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="scene-form-grid">
                <label className="field">
                  <span>Tiêu đề</span>
                  <input
                    value={draft.title}
                    onChange={(event) => updateDraft('title', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Mục đích</span>
                  <select
                    value={draft.purpose}
                    onChange={(event) =>
                      updateDraft('purpose', event.target.value as SceneDto['purpose'])
                    }
                  >
                    {scenePurposeOptions.map((value) => (
                      <option key={value} value={value}>
                        {scenePurposeLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Tóm tắt</span>
                  <textarea
                    value={draft.summary}
                    onChange={(event) => updateDraft('summary', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Địa điểm</span>
                  <input
                    list="scene-locations"
                    value={draft.location ?? ''}
                    onChange={(event) => updateDraft('location', event.target.value || null)}
                  />
                  <datalist id="scene-locations">
                    {locations.map((location) => (
                      <option key={location.id} value={location.name} />
                    ))}
                  </datalist>
                </label>
                <label className="field">
                  <span>Thời điểm</span>
                  <input
                    value={draft.timeOfDay}
                    onChange={(event) => updateDraft('timeOfDay', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Thời tiết</span>
                  <input
                    value={draft.weather}
                    onChange={(event) => updateDraft('weather', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Tâm trạng</span>
                  <input
                    value={draft.mood}
                    onChange={(event) => updateDraft('mood', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Khung hình</span>
                  <select
                    value={draft.camera.framing}
                    onChange={(event) =>
                      updateCamera('framing', event.target.value as SceneDto['camera']['framing'])
                    }
                  >
                    {sceneFramingOptions.map((value) => (
                      <option key={value} value={value}>
                        {sceneFramingLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Góc máy</span>
                  <input
                    value={draft.camera.angle ?? ''}
                    onChange={(event) => updateCamera('angle', event.target.value || null)}
                  />
                </label>
                <label className="field">
                  <span>Mô tả hình ảnh</span>
                  <textarea
                    value={draft.visualDescription}
                    onChange={(event) => updateDraft('visualDescription', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Ánh sáng</span>
                  <textarea
                    value={draft.lighting}
                    onChange={(event) => updateDraft('lighting', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Tông màu</span>
                  <input
                    value={draft.colorMood}
                    onChange={(event) => updateDraft('colorMood', event.target.value)}
                  />
                </label>
                <label className="field field-wide">
                  <span>Prompt hình ảnh</span>
                  <textarea
                    value={draft.imagePrompt}
                    onChange={(event) => updateDraft('imagePrompt', event.target.value)}
                  />
                </label>
                <label className="field field-wide">
                  <span>Prompt loại trừ</span>
                  <textarea
                    value={draft.negativePrompt ?? ''}
                    onChange={(event) => updateDraft('negativePrompt', event.target.value || null)}
                  />
                </label>
                <label className="field field-wide">
                  <span>Ghi chú liên tục</span>
                  <textarea
                    value={draft.continuityNotes}
                    onChange={(event) => updateDraft('continuityNotes', event.target.value)}
                  />
                </label>
              </div>
              <div className="actions">
                <button type="submit">Lưu cảnh</button>
                <button
                  type="button"
                  className="secondary"
                  disabled={sceneJobIds.length > 0}
                  onClick={() => void regenerateScene()}
                >
                  Tạo lại cảnh
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={sceneJobIds.length > 0}
                  onClick={() => void refreshPrompt()}
                >
                  Làm mới prompt hình ảnh
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      <form className="location-quick-add panel" onSubmit={(event) => void createLocation(event)}>
        <div>
          <h4>Danh mục địa điểm</h4>
          <p className="muted">
            Địa điểm mới được lưu dạng bản nháp để duyệt trước khi dùng rộng hơn.
          </p>
        </div>
        <input
          aria-label="Tên địa điểm mới"
          placeholder="Tên địa điểm mới"
          value={newLocationName}
          onChange={(event) => setNewLocationName(event.target.value)}
        />
        <button type="submit">Thêm địa điểm</button>
      </form>
    </section>
  );
}

type ChapterTableProps = {
  chapters: ChapterDto[];
  activeChapterId: string | null;
  offset: number;
  pageSize: number;
  search: string;
  status: ChapterStatusFilter;
  onSearch: (value: string) => void;
  onStatus: (value: ChapterStatusFilter) => void;
  onPageChange: (offset: number) => void;
  onSelect: (chapterId: string) => void;
  onEdit: (chapterId: string, patch: Partial<Pick<ChapterDto, 'title' | 'content'>>) => void;
  onSave: (chapter: ChapterDto) => void;
  onSummary: (chapter: ChapterDto) => void;
  onAdd: () => void;
  onGenerate: (chapter: ChapterDto) => void;
};
function ChapterTable({
  chapters,
  activeChapterId,
  offset,
  pageSize,
  search,
  status,
  onSearch,
  onStatus,
  onPageChange,
  onSelect,
  onEdit,
  onSave,
  onSummary,
  onAdd,
  onGenerate,
}: ChapterTableProps) {
  return (
    <section className="chapter-browser">
      <div className="section-head">
        <div>
          <h3>Chapters</h3>
          <p className="muted">Chỉ tải nội dung của trang hiện tại để duyệt an toàn.</p>
        </div>
        <button onClick={onAdd}>+ Chương</button>
      </div>
      <div className="chapter-browser-controls">
        <label className="field search-field">
          <span>Tìm chương</span>
          <input
            value={search}
            placeholder="Tìm theo tiêu đề hoặc nội dung"
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Lọc trạng thái</span>
          <select
            value={status}
            onChange={(event) => onStatus(event.target.value as ChapterStatusFilter)}
          >
            <option value="">Tất cả</option>
            <option value="FAILED">Lỗi</option>
            <option value="PENDING">Đang chờ</option>
            <option value="CONTINUITY_STALE">Continuity stale</option>
            <option value="WARN">Cảnh báo</option>
          </select>
        </label>
        <div className="pagination" aria-label="Phân trang chương">
          <button
            className="secondary"
            disabled={offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
          >
            Trước
          </button>
          <span>
            {chapters.length ? `${offset + 1}-${offset + chapters.length}` : 'Không có chương'}
          </span>
          <button
            className="secondary"
            disabled={chapters.length < pageSize}
            onClick={() => onPageChange(offset + pageSize)}
          >
            Sau
          </button>
        </div>
      </div>
      {chapters.length === 0 ? (
        <div className="story-empty">
          <strong>Không có chương phù hợp</strong>
          <span>Thử xóa bộ lọc hoặc tạo chương mới.</span>
        </div>
      ) : (
        chapters.map((chapter) => {
          const selected = chapter.id === activeChapterId;
          return (
            <article className={`chapter ${selected ? 'chapter-active' : ''}`} key={chapter.id}>
              <div className="chapter-title-row">
                <input
                  aria-label={`Tiêu đề chương ${chapter.number}`}
                  value={chapter.title}
                  onChange={(event) => onEdit(chapter.id, { title: event.target.value })}
                />
                <span className="chapter-number">Chương {chapter.number}</span>
              </div>
              {selected ? (
                <textarea
                  aria-label={`Nội dung chương ${chapter.number}`}
                  value={chapter.content}
                  onChange={(event) => onEdit(chapter.id, { content: event.target.value })}
                />
              ) : (
                <p className="chapter-preview">{chapter.content.slice(0, 320)}</p>
              )}
              <div className="chapter-foot">
                <span>revision {chapter.revision}</span>
                <span
                  className={`origin-badge ${chapter.origin === 'GENERATED' ? 'generated' : ''}`}
                >
                  {chapter.origin === 'GENERATED' ? 'AI tạo - cần duyệt' : 'Thủ công'}
                </span>
                <span className="muted">
                  Tóm tắt: {chapter.summaryStatus ?? 'MISSING'} · Liên tục:{' '}
                  {chapter.continuityStatus ?? 'NOT_ANALYZED'} · Audio:{' '}
                  {chapter.audioStatus ?? 'PENDING'} · Phụ đề: {chapter.subtitleStatus ?? 'PENDING'}
                </span>
                <button
                  className="secondary"
                  onClick={() => onSelect(chapter.id)}
                  aria-pressed={selected}
                >
                  {selected ? 'Đang chọn' : 'Duyệt chương'}
                </button>
                <button onClick={() => onSave(chapter)}>Lưu nội dung</button>
                <button
                  className="secondary"
                  disabled={!chapter.storyPlanItemId}
                  onClick={() => onGenerate(chapter)}
                >
                  {chapter.origin === 'GENERATED' ? 'Tạo lại chương' : 'Tạo chương'}
                </button>
                <button className="secondary" onClick={() => onSummary(chapter)}>
                  Tạo tóm tắt
                </button>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
type ArcReviewCardProps = {
  arc: StoryArc;
  windowCount: number;
  onSave: (arc: StoryArc) => Promise<void>;
};

function ArcReviewCard({ arc, windowCount, onSave }: ArcReviewCardProps) {
  const [title, setTitle] = useState(arc.title);
  const [goal, setGoal] = useState(arc.goal);
  const [conflict, setConflict] = useState(arc.conflict);
  const [plannedOutcome, setPlannedOutcome] = useState(arc.plannedOutcome);

  useEffect(() => {
    setTitle(arc.title);
    setGoal(arc.goal);
    setConflict(arc.conflict);
    setPlannedOutcome(arc.plannedOutcome);
  }, [arc.id, arc.title, arc.goal, arc.conflict, arc.plannedOutcome]);

  const save = async (): Promise<void> => {
    await onSave({ ...arc, title, goal, conflict, plannedOutcome });
  };

  return (
    <article className="arc-card">
      <div className="section-head">
        <strong>{arc.ordinalIndex}. Duyệt arc</strong>
        <span className={`status-chip status-${arc.status.toLowerCase()}`}>{arc.status}</span>
      </div>
      <small>
        Chương {arc.startChapter}-{arc.endChapter} · {windowCount} cửa sổ
      </small>
      {arc.status === 'STALE' && (
        <p className="warning">
          Blueprint/settings đã thay đổi. Kiểm tra lại arc trước khi tạo tiếp.
        </p>
      )}
      <label className="field">
        <span>Tiêu đề arc</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="field">
        <span>Mục tiêu</span>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} />
      </label>
      <label className="field">
        <span>Xung đột</span>
        <textarea value={conflict} onChange={(event) => setConflict(event.target.value)} />
      </label>
      <label className="field">
        <span>Kết quả dự kiến</span>
        <textarea
          value={plannedOutcome}
          onChange={(event) => setPlannedOutcome(event.target.value)}
        />
      </label>
      <button onClick={() => void save()}>Lưu chỉnh sửa arc</button>
    </article>
  );
}
type WindowReviewCardProps = {
  projectId: string;
  summary: StoryPlanWindowSummary;
  onSave: (window: StoryPlanWindowResult) => Promise<void>;
};

type EditablePlanField =
  'title' | 'purpose' | 'summary' | 'setting' | 'conflict' | 'resolution' | 'emotionalArc';

function WindowReviewCard({ projectId, summary, onSave }: WindowReviewCardProps) {
  const [draft, setDraft] = useState<StoryPlanWindowResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [summary.window.id, summary.window.inputFingerprint, summary.itemCount]);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setDraft(await storyApi.getPlanWindow(projectId, summary.window.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đọc cửa sổ kế hoạch');
    } finally {
      setLoading(false);
    }
  };

  const setItemField = (index: number, key: EditablePlanField, value: string): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, itemIndex) =>
              itemIndex === index ? { ...item, [key]: value } : item,
            ),
          }
        : current,
    );
  };

  return (
    <article className="arc-card">
      <div className="section-head">
        <strong>
          Cửa sổ {summary.window.startChapter}-{summary.window.endChapter}
        </strong>
        <span className={`status-chip status-${summary.window.status.toLowerCase()}`}>
          {summary.window.status}
        </span>
      </div>
      <small>
        Arc {summary.window.arcId} · {summary.itemCount} dàn ý · ID {summary.window.id}
      </small>
      {error && <small className="warning">{error}</small>}
      {!draft ? (
        <button className="secondary" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang tải...' : 'Mở chỉnh sửa cửa sổ'}
        </button>
      ) : (
        <form
          className="story-settings"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(draft).then(() => setDraft(null));
          }}
        >
          {draft.items.map((item, index) => (
            <div className="window-item-editor" key={item.id}>
              <strong>
                Chương {item.chapterNumber} · ID {item.id}
              </strong>
              <label className="field">
                <span>Tiêu đề</span>
                <input
                  required
                  value={item.title}
                  onChange={(event) => setItemField(index, 'title', event.target.value)}
                />
              </label>
              <label className="field field-wide">
                <span>Tóm tắt</span>
                <textarea
                  required
                  value={item.summary}
                  onChange={(event) => setItemField(index, 'summary', event.target.value)}
                />
              </label>
              <label className="field field-wide">
                <span>Xung đột</span>
                <textarea
                  required
                  value={item.conflict}
                  onChange={(event) => setItemField(index, 'conflict', event.target.value)}
                />
              </label>
              <label className="field field-wide">
                <span>Hướng giải quyết</span>
                <textarea
                  required
                  value={item.resolution}
                  onChange={(event) => setItemField(index, 'resolution', event.target.value)}
                />
              </label>
            </div>
          ))}
          <div className="actions">
            <button type="submit">Lưu revision cửa sổ</button>
            <button className="secondary" type="button" onClick={() => setDraft(null)}>
              Hủy
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

type LongStoryDashboardProps = {
  projectId: string;
  story: StorySnapshotDto;
  chapters: ChapterDto[];
  activeChapterId: string | null;
  onChanged: () => void;
  onError: (message: string) => void;
};

type BatchMode = 'NEXT' | 'RANGE' | 'UNTIL_END';
type BatchRequestPayload = {
  mode: BatchMode;
  count?: number;
  startChapter?: number;
  endChapter?: number;
};

function formatUsage(usage: StoryUsageSummary): string {
  return `${usage.operations} lượt · ${usage.knownInputTokens + usage.knownOutputTokens} token đã biết · $${usage.knownCostUsd.toFixed(4)}`;
}

function LongStoryDashboard({
  projectId,
  story,
  chapters,
  activeChapterId,
  onChanged,
  onError,
}: LongStoryDashboardProps) {
  const [mode, setMode] = useState<BatchMode>('NEXT');
  const [count, setCount] = useState(5);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(5);
  const [arcId, setArcId] = useState('');
  const [windowStart, setWindowStart] = useState(1);
  const [windowEnd, setWindowEnd] = useState(20);
  const [batchItems, setBatchItems] = useState<Record<string, StoryGenerationBatchItem[]>>({});
  const [rebuildFrom, setRebuildFrom] = useState(1);

  useEffect(() => {
    const firstArc = story.arcs[0];
    if (firstArc && !story.arcs.some((arc) => arc.id === arcId)) setArcId(firstArc.id);
    const nextChapter = (story.state?.currentChapter ?? 0) + 1;
    if (story.state?.revision) {
      setRangeStart(nextChapter);
      setRangeEnd(Math.min(story.longStoryCounts.targetChapterCount, nextChapter + 4));
    }
  }, [
    story.arcs,
    story.state?.revision,
    story.state?.currentChapter,
    arcId,
    story.longStoryCounts.targetChapterCount,
  ]);

  useEffect(() => {
    const arc = story.arcs.find((item) => item.id === arcId);
    if (arc) {
      setWindowStart(arc.startChapter);
      setWindowEnd(Math.min(arc.endChapter, arc.startChapter + 19));
    }
  }, [arcId, story.arcs]);

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<void> => {
    try {
      await action();
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : fallback);
    }
  };

  const startBatch = (): Promise<void> => {
    const payload: BatchRequestPayload =
      mode === 'NEXT'
        ? { mode, count }
        : mode === 'RANGE'
          ? { mode, startChapter: rangeStart, endChapter: rangeEnd }
          : { mode };
    return run(
      () => storyApi.generateBatch(projectId, payload),
      'Không thể bắt đầu batch tạo chương',
    );
  };

  const generateWindow = (): Promise<void> => {
    if (!arcId) {
      onError('Cần tạo hoặc chọn một arc trước khi lập kế hoạch cửa sổ.');
      return Promise.resolve();
    }
    return run(
      () =>
        storyApi.generatePlanWindow(projectId, {
          arcId,
          startChapter: windowStart,
          endChapter: windowEnd,
        }),
      'Không thể lập kế hoạch cửa sổ',
    );
  };

  const toggleBatchItems = async (batchId: string): Promise<void> => {
    if (batchItems[batchId]) {
      setBatchItems((current) => {
        const next = { ...current };
        delete next[batchId];
        return next;
      });
      return;
    }
    try {
      const items = await storyApi.batchItems(projectId, batchId);
      setBatchItems((current) => ({ ...current, [batchId]: items }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể đọc chi tiết batch');
    }
  };

  const retryItem = (batch: StoryGenerationBatch, item: StoryGenerationBatchItem): Promise<void> =>
    run(async () => {
      await storyApi.retryBatchItem(projectId, batch.id, item.chapterNumber);
      setBatchItems((current) => {
        const next = { ...current };
        delete next[batch.id];
        return next;
      });
    }, 'Không thể thử lại chương trong batch');

  const skipItem = (batch: StoryGenerationBatch, item: StoryGenerationBatchItem): Promise<void> => {
    const reason = window.prompt('Lý do bỏ qua chương này', item.error ?? 'Cần xem xét thủ công');
    if (!reason?.trim()) return Promise.resolve();
    return run(async () => {
      await storyApi.skipBatchItem(projectId, batch.id, item.chapterNumber, reason.trim());
      setBatchItems((current) => {
        const next = { ...current };
        delete next[batch.id];
        return next;
      });
    }, 'Không thể bỏ qua chương trong batch');
  };

  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  const activeChecks = story.continuityChecks
    .filter((check) => !activeChapter || check.chapterId === activeChapter.id)
    .slice(0, 3);
  const staleFrom =
    chapters.find((chapter) => chapter.continuityStatus === 'CONTINUITY_STALE')?.number ??
    activeChapter?.number ??
    1;
  const saveArc = (arc: StoryArc): Promise<void> =>
    run(() => storyApi.updateArc(projectId, arc), 'Không thể lưu chỉnh sửa arc');
  const saveWindow = (window: StoryPlanWindowResult): Promise<void> =>
    run(() => storyApi.updatePlanWindow(projectId, window), 'Không thể lưu chỉnh sửa cửa sổ');

  return (
    <section className="long-story-dashboard">
      <div className="section-head">
        <div>
          <p className="eyebrow">LONG STORY ENGINE</p>
          <h3>Bảng điều khiển truyện dài</h3>
          <p className="muted">
            Lập kế hoạch trước, tạo theo batch, kiểm tra continuity trước khi nhận.
          </p>
        </div>
        <div className="actions">
          <button
            onClick={() => void run(() => storyApi.generateArcs(projectId), 'Không thể tạo arc')}
          >
            Tạo arcs
          </button>
          <button
            className="secondary"
            onClick={() =>
              void run(() => storyApi.compactSummary(projectId), 'Không thể nén tóm tắt')
            }
          >
            Nén rolling summary
          </button>
        </div>
      </div>

      <div className="story-metric-grid">
        <div className="metric-card">
          <span>Mục tiêu</span>
          <strong>{story.longStoryCounts.targetChapterCount} chương</strong>
        </div>
        <div className="metric-card">
          <span>Đã lập kế hoạch</span>
          <strong>{story.longStoryCounts.plannedChapterCount}</strong>
        </div>
        <div className="metric-card">
          <span>Đã tạo</span>
          <strong>{story.longStoryCounts.generatedChapterCount}</strong>
        </div>
        <div className="metric-card">
          <span>Arc</span>
          <strong>{story.longStoryCounts.arcCount}</strong>
        </div>
        <div className="metric-card">
          <span>Cảnh báo continuity</span>
          <strong>{story.longStoryCounts.continuityWarningCount}</strong>
        </div>
        <div className="metric-card">
          <span>Chương stale</span>
          <strong>{story.longStoryCounts.staleChapterCount}</strong>
        </div>
        <div className="metric-card">
          <span>Đang chặn</span>
          <strong>
            {story.longStoryCounts.currentBlockingChapter
              ? `Chương ${story.longStoryCounts.currentBlockingChapter}`
              : 'Không'}
          </strong>
        </div>
      </div>

      <div className="long-story-grid">
        <section className="panel">
          <div className="section-head">
            <h4>Điều phối tạo chương</h4>
            <span className="provenance">Checkpoint {story.state?.currentChapter ?? 0}</span>
          </div>
          <div className="story-field-grid">
            <label className="field">
              <span>Chế độ</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as BatchMode)}>
                <option value="NEXT">NEXT - tiếp theo</option>
                <option value="RANGE">RANGE - khoảng chọn</option>
                <option value="UNTIL_END">UNTIL_END - đến hết</option>
              </select>
            </label>
            {mode === 'NEXT' && (
              <label className="field">
                <span>Số chương</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              </label>
            )}
            {mode === 'RANGE' && (
              <>
                <label className="field">
                  <span>Từ chương</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={rangeStart}
                    onChange={(event) => setRangeStart(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Đến chương</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(Number(event.target.value))}
                  />
                </label>
              </>
            )}
          </div>
          <div className="actions">
            <button onClick={() => void startBatch()}>Bắt đầu batch</button>
            <button
              className="secondary"
              onClick={() =>
                void run(
                  () => storyApi.analyzeChapter(activeChapterId ?? ''),
                  'Không thể phân tích chương',
                )
              }
              disabled={!activeChapterId}
            >
              Phân tích chương đang chọn
            </button>
            <button
              className="secondary"
              onClick={() =>
                void run(
                  () => storyApi.checkContinuity(activeChapterId ?? ''),
                  'Không thể kiểm tra continuity',
                )
              }
              disabled={!activeChapterId}
            >
              Kiểm tra continuity
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <h4>Lập kế hoạch cửa sổ</h4>
            <span className="provenance">Tối đa 25 chương</span>
          </div>
          <div className="story-field-grid">
            <label className="field">
              <span>Arc</span>
              <select
                value={arcId}
                onChange={(event) => setArcId(event.target.value)}
                disabled={!story.arcs.length}
              >
                {story.arcs.map((arc) => (
                  <option key={arc.id} value={arc.id}>
                    {arc.ordinalIndex}. {arc.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Từ</span>
              <input
                type="number"
                min={1}
                max={200}
                value={windowStart}
                onChange={(event) => setWindowStart(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Đến</span>
              <input
                type="number"
                min={1}
                max={200}
                value={windowEnd}
                onChange={(event) => setWindowEnd(Number(event.target.value))}
              />
            </label>
          </div>
          <button onClick={() => void generateWindow()} disabled={!story.arcs.length}>
            Lập kế hoạch cửa sổ
          </button>
        </section>
      </div>

      <section className="panel">
        <div className="section-head">
          <h4>Story arcs</h4>
          <span className="muted">{story.arcs.length} arc</span>
        </div>
        {story.arcs.length === 0 ? (
          <p className="muted">Chưa có arc. Tạo arcs sau khi lưu settings và blueprint.</p>
        ) : (
          <div className="arc-grid">
            {story.arcs.map((arc: StoryArc) => {
              const windows = story.planWindows.filter((item) => item.window.arcId === arc.id);
              return (
                <ArcReviewCard
                  key={arc.id}
                  arc={arc}
                  windowCount={windows.length}
                  onSave={saveArc}
                />
              );
            })}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="section-head">
          <h4>Plan windows</h4>
          <span className="muted">{story.planWindows.length} cửa sổ</span>
        </div>
        {story.planWindows.length === 0 ? (
          <p className="muted">Chưa có cửa sổ kế hoạch để duyệt.</p>
        ) : (
          <div className="arc-grid">
            {story.planWindows.map((summary) => (
              <WindowReviewCard
                key={summary.window.id}
                projectId={projectId}
                summary={summary}
                onSave={saveWindow}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <h4>Batch gần đây</h4>
          <span className="muted">{story.batches.length} batch</span>
        </div>
        {story.batches.length === 0 ? (
          <p className="muted">Chưa có batch.</p>
        ) : (
          story.batches.slice(0, 10).map((batch) => (
            <div className="batch-row" key={batch.id}>
              <div>
                <strong>
                  {batch.mode} · chương {batch.startChapter}-{batch.endChapter}
                </strong>
                <small>
                  {batch.completed}/{batch.total} hoàn tất · {batch.failed} lỗi · {batch.skipped} bỏ
                  qua
                </small>
                {batch.error && <em>{batch.error}</em>}
              </div>
              <div className="actions">
                <span className={`status-chip status-${batch.status.toLowerCase()}`}>
                  {batch.status}
                </span>
                <button className="secondary" onClick={() => void toggleBatchItems(batch.id)}>
                  {batchItems[batch.id] ? 'Ẩn chi tiết' : 'Chi tiết'}
                </button>
                {(batch.status === 'RUNNING' || batch.status === 'PENDING') && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(
                        () => storyApi.cancelBatch(projectId, batch.id),
                        'Không thể hủy batch',
                      )
                    }
                  >
                    Hủy
                  </button>
                )}
              </div>
              {batchItems[batch.id]?.map((item) => (
                <div className="batch-item" key={item.id}>
                  <span>Chương {item.chapterNumber}</span>
                  <strong>{item.outcome}</strong>
                  {item.error && <em>{item.error}</em>}
                  {item.outcome === 'FAILED' && (
                    <>
                      <button className="secondary" onClick={() => void retryItem(batch, item)}>
                        Thử lại
                      </button>
                      <button className="secondary" onClick={() => void skipItem(batch, item)}>
                        Bỏ qua có lý do
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <div className="long-story-grid">
        <section className="panel">
          <div className="section-head">
            <h4>Continuity của chương đang chọn</h4>
            <span className="muted">{activeChapter?.title ?? 'Chưa chọn'}</span>
          </div>
          {activeChecks.length === 0 ? (
            <p className="muted">
              Chưa có kết quả. Chạy phân tích hoặc kiểm tra continuity sau khi chọn chương.
            </p>
          ) : (
            activeChecks.map((check) => (
              <article className="continuity-card" key={check.id}>
                <div className="section-head">
                  <strong>{check.result.status}</strong>
                  <span>{check.result.issues.length} vấn đề</span>
                </div>
                {check.result.issues.map((issue, index) => (
                  <p key={`${issue.type}-${index}`}>
                    <b>{issue.severity}</b> · {issue.message}
                  </p>
                ))}
                {check.stateDelta && check.summary && !check.acceptedAt && (
                  <button
                    onClick={() =>
                      void run(
                        () => storyApi.acceptAnalysis(check.chapterId, check.id),
                        'Không thể nhận phân tích thủ công',
                      )
                    }
                  >
                    Nhận state delta
                  </button>
                )}
                {check.acceptedAt && (
                  <small className="muted">Đã nhận lúc {check.acceptedAt}</small>
                )}
              </article>
            ))
          )}
        </section>
        <section className="panel">
          <div className="section-head">
            <h4>Usage và rebuild</h4>
            <span className="provenance">Chi phí đã biết</span>
          </div>
          <p className="usage-total">{formatUsage(story.usageSummary)}</p>
          <p className="muted">
            Không rõ chi phí: {story.usageSummary.unavailableCount} lượt. Usage không có dữ liệu sẽ
            không bị đoán.
          </p>
          <div className="context-diagnostics">
            <strong>Context gần đây</strong>
            {story.contextDiagnostics
              .filter((item) => item.contextDiagnostics)
              .slice(0, 5)
              .map((item) => {
                const diagnostics = item.contextDiagnostics!;
                return (
                  <small key={item.id}>
                    {item.operation} · {diagnostics.estimatedTokens}/{diagnostics.budget} token ·
                    nhân vật {diagnostics.selectedCharacterCount} · thread{' '}
                    {diagnostics.selectedThreadCount} · tóm tắt{' '}
                    {diagnostics.recentSummariesIncluded}
                    {diagnostics.omittedSections.length
                      ? ` · bỏ qua: ${diagnostics.omittedSections.slice(0, 4).join(', ')}`
                      : ''}
                  </small>
                );
              })}
            {!story.contextDiagnostics.some((item) => item.contextDiagnostics) && (
              <small className="muted">Chưa có chẩn đoán context.</small>
            )}
          </div>
          <label className="field">
            <span>Rebuild continuity từ chương</span>
            <input
              type="number"
              min={1}
              max={story.longStoryCounts.targetChapterCount}
              value={rebuildFrom}
              onChange={(event) => setRebuildFrom(Number(event.target.value))}
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              void run(
                () => storyApi.rebuildContinuity(projectId, rebuildFrom),
                'Không thể rebuild continuity',
              )
            }
          >
            Rebuild state
          </button>
          <button
            className="secondary"
            onClick={() =>
              void run(
                () =>
                  window.confirm(
                    `Giữ các chương từ chương ${staleFrom} ở trạng thái stale và không thay đổi nội dung?`,
                  )
                    ? storyApi.keepStale(projectId, staleFrom)
                    : Promise.resolve(),
                'Không thể giữ suffix stale',
              )
            }
          >
            Giữ suffix stale
          </button>
        </section>
      </div>
    </section>
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
