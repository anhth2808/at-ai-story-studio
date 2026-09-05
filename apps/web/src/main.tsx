import { StrictMode, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent } from 'react';
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
  ImageGenerationSettingsDto,
  ImageReadiness,
  SceneImageGenerationDto,
  MotionSource,
  AiMotionIntensity,
  AiMotionPlanDto,
  AiMotionPlanUpdate,
  SceneVideoGenerationDto,
  VideoReadiness,
  VideoGenerationSettingsDto,
  VideoGenerationSettingsUpdate,
  ChapterTimeline,
  MotionPlan,
  RenderPlan,
  SceneTimingUpdate,
  ShotPlanDto,
  VisualReferenceGeneration,
} from '@studio/shared';
import './styles.css';
import { ProductionWorkspace } from './ProductionWorkspace.js';
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const SELECTED_PROJECT_STORAGE_KEY = 'studio.selectedProjectId';
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
  const headers =
    isMultipart || init?.body === undefined
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
const shotApi = {
  current: (projectId: string, sceneId: string) =>
    api<ShotPlanDto | null>(`/api/projects/${projectId}/scenes/${sceneId}/shot-plan`),
  generate: (
    projectId: string,
    sceneId: string,
    expectedSceneRevision: number,
    regenerate = false,
  ) =>
    api<StoryJobScheduleDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/shot-plan/${regenerate ? 'regenerate' : 'generate'}`,
      { method: 'POST', body: JSON.stringify({ expectedSceneRevision }) },
    ),
  review: (
    projectId: string,
    shotPlanId: string,
    status: 'APPROVED' | 'REJECTED',
    expectedRowVersion: number,
  ) =>
    api<ShotPlanDto>(`/api/projects/${projectId}/shot-plans/${shotPlanId}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, notes: '', expectedRowVersion }),
    }),
};
const visualReferenceApi = {
  list: (projectId: string, targetKind: string, targetEntityId: string) =>
    api<VisualReferenceGeneration[]>(
      `/api/projects/${projectId}/visual-references?targetKind=${encodeURIComponent(targetKind)}&targetEntityId=${encodeURIComponent(targetEntityId)}&limit=20`,
    ),
  generate: (projectId: string, targetKind: string, targetEntityId: string) =>
    api<{ jobId: string }>(`/api/projects/${projectId}/visual-references/generate`, {
      method: 'POST',
      body: JSON.stringify({ targetKind, targetEntityId }),
    }),
  review: (projectId: string, generationId: string, approval: 'APPROVED' | 'REJECTED') =>
    api<VisualReferenceGeneration>(
      `/api/projects/${projectId}/visual-references/${generationId}/review`,
      { method: 'POST', body: JSON.stringify({ approval }) },
    ),
};
type TimelineRenderRequest = {
  source: 'SCENES';
  scope:
    | { kind: 'SCENE'; sceneId: string }
    | { kind: 'CHAPTER'; chapterId: string }
    | { kind: 'CHAPTER_RANGE'; startChapterNumber: number; endChapterNumber: number }
    | { kind: 'SELECTED_CHAPTERS'; chapterIds: string[] }
    | { kind: 'FULL_STORY' };
  autoBuild: boolean;
  fallbackPolicy: 'FAIL' | 'HOLD_PREVIOUS' | 'BLACK' | 'PROJECT_BACKGROUND';
  qualityPreset?: 'FAST_PREVIEW' | 'STANDARD' | 'HIGH';
  fitMode?: 'COVER' | 'CONTAIN';
};
type TimelineRenderResponse = {
  executionId: string;
  jobIds: string[];
  jobId: string | null;
  plan: RenderPlan;
};
const timelineApi = {
  get: (projectId: string, chapterId: string) =>
    api<ChapterTimeline | null>(`/api/projects/${projectId}/chapters/${chapterId}/timeline`),
  buildTiming: (projectId: string, chapterId: string) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/chapters/${chapterId}/timeline/timing`, {
      method: 'POST',
    }),
  buildMotion: (projectId: string, chapterId: string, replace = false) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/chapters/${chapterId}/timeline/motion`, {
      method: 'POST',
      body: JSON.stringify({ replace }),
    }),
  saveTiming: (projectId: string, chapterId: string, input: SceneTimingUpdate) =>
    api<StoryJobScheduleDto>(`/api/projects/${projectId}/chapters/${chapterId}/timeline`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  saveMotion: (projectId: string, chapterId: string, sceneId: string, motion: MotionPlan) =>
    api<MotionPlan>(`/api/projects/${projectId}/chapters/${chapterId}/timeline/motion`, {
      method: 'PATCH',
      body: JSON.stringify({
        sceneId,
        expectedRevision: motion.revision,
        motionType: motion.motionType,
        startScale: motion.startScale,
        endScale: motion.endScale,
        startPosition: motion.startPosition,
        endPosition: motion.endPosition,
        easing: motion.easing,
        focusPoint: motion.focusPoint,
        intensity: motion.intensity,
      }),
    }),
  plan: (projectId: string, input: TimelineRenderRequest) => {
    const scopeQuery: Record<string, string> =
      input.scope.kind === 'SCENE'
        ? { scopeKind: 'SCENE', sceneId: input.scope.sceneId }
        : input.scope.kind === 'CHAPTER'
          ? { scopeKind: 'CHAPTER', chapterId: input.scope.chapterId }
          : input.scope.kind === 'CHAPTER_RANGE'
            ? {
                scopeKind: 'CHAPTER_RANGE',
                startChapterNumber: String(input.scope.startChapterNumber),
                endChapterNumber: String(input.scope.endChapterNumber),
              }
            : input.scope.kind === 'SELECTED_CHAPTERS'
              ? { scopeKind: 'SELECTED_CHAPTERS', chapterIds: input.scope.chapterIds.join(',') }
              : { scopeKind: 'FULL_STORY' };
    const query = new URLSearchParams({
      source: input.source,
      autoBuild: String(input.autoBuild),
      fallbackPolicy: input.fallbackPolicy,
      ...scopeQuery,
      ...(input.qualityPreset ? { qualityPreset: input.qualityPreset } : {}),
      ...(input.fitMode ? { fitMode: input.fitMode } : {}),
    });
    return api<RenderPlan>(`/api/projects/${projectId}/render/plan?${query.toString()}`);
  },
  render: (projectId: string, input: TimelineRenderRequest) =>
    api<TimelineRenderResponse>(`/api/projects/${projectId}/render`, {
      method: 'POST',
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

type ImageScheduleDto = {
  executionId: string;
  stepId: string;
  jobId: string;
  generation: SceneImageGenerationDto;
};
type VideoScheduleDto = {
  executionId: string;
  stepId: string;
  jobId: string;
  generation: SceneVideoGenerationDto;
  reused: boolean;
};
type AiMotionStateDto = {
  motionSource: MotionSource;
  motionPlan: AiMotionPlanDto | null;
  current: SceneVideoGenerationDto | null;
  generations: SceneVideoGenerationDto[];
};
type CharacterReferenceItem = {
  id: string;
  url: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  approval: 'CANDIDATE' | 'APPROVED' | 'REJECTED';
  displayName: string;
  isPrimary: boolean;
  attached: boolean;
  createdAt: string;
};
type CharacterReferencesResponse = {
  characterId: string;
  profileRevision: number | null;
  primaryReferenceId: string | null;
  references: CharacterReferenceItem[];
};
function conditioningSummary(image: SceneImageGenerationDto | null): string {
  if (!image) return '';
  const request = image.metadata['request'] as
    | {
        conditioning?: { mode?: string; characters?: Array<{ characterId: string }> };
        providerSettings?: { workflowTemplate?: string };
      }
    | undefined;
  const conditioning = request?.conditioning;
  if (!conditioning) return '';
  const references = (conditioning.characters ?? []).map((entry) => entry.characterId).join(', ');
  return [
    conditioning.mode ?? '',
    request?.providerSettings?.workflowTemplate ?? '',
    references ? `tham chiếu: ${references}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
const imageApi = {
  settings: (projectId: string) =>
    api<ImageGenerationSettingsDto>(`/api/projects/${projectId}/image-settings`),
  saveSettings: (projectId: string, body: Record<string, unknown>) =>
    api<ImageGenerationSettingsDto>(`/api/projects/${projectId}/image-settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  readiness: (projectId: string) =>
    api<ImageReadiness>(`/api/projects/${projectId}/image-settings/readiness`, {
      method: 'POST',
    }),
  list: (projectId: string, sceneId: string) =>
    api<SceneImageGenerationDto[]>(
      `/api/projects/${projectId}/scenes/${sceneId}/images?limit=50&offset=0`,
    ),
  generate: (
    projectId: string,
    sceneId: string,
    instructions = '',
    conditioningMode?: 'TEXT_ONLY' | 'REFERENCE_CONDITIONED',
    candidateCount = 1,
  ) =>
    api<ImageScheduleDto>(`/api/projects/${projectId}/scenes/${sceneId}/images/generate`, {
      method: 'POST',
      body: JSON.stringify({
        instructions,
        candidateCount,
        ...(conditioningMode ? { conditioningMode } : {}),
      }),
    }),
  regenerate: (
    projectId: string,
    sceneId: string,
    generationId: string,
    mode: 'SAME_SEED' | 'NEW_SEED',
    conditioningMode?: 'TEXT_ONLY' | 'REFERENCE_CONDITIONED',
    useReviewFeedback = false,
  ) =>
    api<ImageScheduleDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/images/${generationId}/regenerate`,
      {
        method: 'POST',
        body: JSON.stringify({
          mode,
          instructions: '',
          useReviewFeedback,
          ...(conditioningMode ? { conditioningMode } : {}),
        }),
      },
    ),
  references: (projectId: string, characterId: string) =>
    api<CharacterReferencesResponse>(
      `/api/projects/${projectId}/characters/${characterId}/references`,
    ),
  uploadReference: (projectId: string, characterId: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return api<{ id: string; approval: string }>(
      `/api/projects/${projectId}/characters/${characterId}/references`,
      { method: 'POST', body },
    );
  },
  setReferenceApproval: (
    projectId: string,
    characterId: string,
    assetId: string,
    approval: 'CANDIDATE' | 'APPROVED' | 'REJECTED',
  ) =>
    api<{ id: string; approval: string }>(
      `/api/projects/${projectId}/characters/${characterId}/references/${assetId}/approval`,
      { method: 'PATCH', body: JSON.stringify({ approval }) },
    ),
  setProfileReferences: (
    projectId: string,
    characterId: string,
    expectedRevision: number,
    referenceAssetIds: string[],
  ) =>
    api<{ revision: number }>(
      `/api/projects/${projectId}/visual-bible/characters/${characterId}/references`,
      { method: 'PUT', body: JSON.stringify({ expectedRevision, referenceAssetIds }) },
    ),
  promoteReference: (
    projectId: string,
    sceneId: string,
    generationId: string,
    characterId: string,
    expectedRevision: number,
    primary: boolean,
  ) =>
    api<{ assetId: string }>(
      `/api/projects/${projectId}/scenes/${sceneId}/images/${generationId}/promote-reference`,
      {
        method: 'POST',
        body: JSON.stringify({ characterId, expectedRevision, primary }),
      },
    ),
  review: (
    projectId: string,
    sceneId: string,
    generationId: string,
    status: 'UNREVIEWED' | 'REJECTED',
    notes = '',
    scores: Record<string, number> = {},
    issues: string[] = [],
  ) =>
    api<SceneImageGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/images/${generationId}/review`,
      { method: 'PUT', body: JSON.stringify({ status, notes, scores, issues }) },
    ),
  accept: (
    projectId: string,
    sceneId: string,
    generationId: string,
    notes = '',
    scores: Record<string, number> = {},
    issues: string[] = [],
  ) =>
    api<SceneImageGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/images/${generationId}/accept`,
      { method: 'PUT', body: JSON.stringify({ status: 'REJECTED', notes, scores, issues }) },
    ),
  setCurrent: (
    projectId: string,
    sceneId: string,
    generationId: string,
    expectedSceneRevision: number,
  ) =>
    api<SceneImageGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/images/${generationId}/current`,
      { method: 'PUT', body: JSON.stringify({ expectedSceneRevision }) },
    ),
  upload: (projectId: string, sceneId: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return api<SceneImageGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/images/manual`,
      { method: 'POST', body },
    );
  },
  chapterBatch: (projectId: string, chapterId: string) =>
    api<{ jobs: ImageScheduleDto[] }>(
      `/api/projects/${projectId}/chapters/${chapterId}/images/generate-batch`,
      { method: 'POST', body: JSON.stringify({ onlyMissing: true, includeStale: true }) },
    ),
};
const videoApi = {
  settings: (projectId: string) =>
    api<VideoGenerationSettingsDto>(`/api/projects/${projectId}/video-settings`),
  saveSettings: (projectId: string, body: VideoGenerationSettingsUpdate) =>
    api<VideoGenerationSettingsDto>(`/api/projects/${projectId}/video-settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  readiness: (projectId: string) =>
    api<VideoReadiness>(`/api/projects/${projectId}/video-settings/readiness`, {
      method: 'POST',
    }),
  aiMotion: (projectId: string, sceneId: string) =>
    api<AiMotionStateDto>(`/api/projects/${projectId}/scenes/${sceneId}/ai-motion`),
  setMotionSource: (projectId: string, sceneId: string, motionSource: MotionSource) =>
    api<{ sceneId: string; motionSource: MotionSource }>(
      `/api/projects/${projectId}/scenes/${sceneId}/motion-source`,
      { method: 'PUT', body: JSON.stringify({ motionSource }) },
    ),
  saveMotionPlan: (projectId: string, sceneId: string, body: AiMotionPlanUpdate) =>
    api<AiMotionPlanDto>(`/api/projects/${projectId}/scenes/${sceneId}/ai-motion`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  generate: (projectId: string, sceneId: string, instructions = '') =>
    api<VideoScheduleDto>(`/api/projects/${projectId}/scenes/${sceneId}/ai-video/generate`, {
      method: 'POST',
      body: JSON.stringify({ instructions }),
    }),
  regenerate: (
    projectId: string,
    sceneId: string,
    generationId: string,
    mode: 'SAME_SEED' | 'NEW_SEED',
    instructions = '',
    useReviewFeedback = false,
  ) =>
    api<VideoScheduleDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/ai-video/${generationId}/regenerate`,
      {
        method: 'POST',
        body: JSON.stringify({ mode, instructions, useReviewFeedback }),
      },
    ),
  review: (
    projectId: string,
    sceneId: string,
    generationId: string,
    issues: string[] = [],
    notes = '',
  ) =>
    api<SceneVideoGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/ai-video/${generationId}/review`,
      { method: 'PUT', body: JSON.stringify({ status: 'REJECTED', issues, notes }) },
    ),
  accept: (
    projectId: string,
    sceneId: string,
    generationId: string,
    issues: string[] = [],
    notes = '',
  ) =>
    api<SceneVideoGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/ai-video/${generationId}/accept`,
      { method: 'PUT', body: JSON.stringify({ issues, notes }) },
    ),
  setCurrent: (projectId: string, sceneId: string, generationId: string) =>
    api<SceneVideoGenerationDto>(
      `/api/projects/${projectId}/scenes/${sceneId}/ai-video/${generationId}/current`,
      { method: 'PUT' },
    ),
  generateBatch: (projectId: string, sceneIds: string[], onlyMissing = false) =>
    api<{ executionId: string; jobs: VideoScheduleDto[]; skippedSceneIds: string[] }>(
      `/api/projects/${projectId}/ai-video/generate-batch`,
      { method: 'POST', body: JSON.stringify({ sceneIds, onlyMissing }) },
    ),
  generateChapterMissing: (projectId: string, chapterId: string) =>
    api<{ executionId: string; jobs: VideoScheduleDto[]; skippedSceneIds: string[] }>(
      `/api/projects/${projectId}/chapters/${chapterId}/ai-video/generate-missing`,
      { method: 'POST' },
    ),
};
async function loadRender(projectId: string): Promise<RenderAsset | null> {
  const asset = await api<RenderAsset>(`/api/projects/${projectId}/video`)
    .catch(() => api<RenderAsset>(`/api/projects/${projectId}/render`))
    .catch(() => null);
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
  const [timeline, setTimeline] = useState<ChapterTimeline | null>(null);
  const [renderPlan, setRenderPlan] = useState<RenderPlan | null>(null);
  const [timelineError, setTimelineError] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Story');
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [chapterOffset, setChapterOffset] = useState(0);
  const [chapterSearch, setChapterSearch] = useState('');
  const [chapterStatus, setChapterStatus] = useState<ChapterStatusFilter>('');
  const refreshSequence = useRef(0);
  const chapterPageSize = 25;

  const refresh = async (): Promise<void> => {
    const sequence = ++refreshSequence.current;
    const isCurrent = (): boolean => sequence === refreshSequence.current;
    try {
      const [nextHealth, nextProjects] = await Promise.all([
        api<Health>('/api/health'),
        api<ProjectDto[]>('/api/projects'),
      ]);
      if (!isCurrent()) return;
      setHealth(nextHealth);
      setProjects(nextProjects);
      const savedProjectId = window.localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY);
      if (!selected) {
        const restored = savedProjectId
          ? nextProjects.find((project) => project.id === savedProjectId)
          : null;
        if (restored) {
          setSelected(restored);
          return;
        }
        if (savedProjectId) window.localStorage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
      }
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
        if (!isCurrent()) return;
        setSelected(detail.project);
        setChapters(nextChapters);
        const nextStory = await storyApi.snapshot(selected.id);
        if (!isCurrent()) return;
        setStory(nextStory);
        const chapterId =
          activeChapterId && nextChapters.some((chapter) => chapter.id === activeChapterId)
            ? activeChapterId
            : nextChapters[0]?.id;
        setActiveChapterId(chapterId ?? null);
        const nextStatus = await api<StatusSummary>(
          chapterId ? `/api/chapters/${chapterId}/status` : `/api/projects/${selected.id}/status`,
        );
        if (!isCurrent()) return;
        setStatus(nextStatus);
        const currentJobs = await Promise.all(
          jobs.map((job) => api<JobDto>(`/api/jobs/${job.id}`).catch(() => job)),
        );
        if (!isCurrent()) return;
        setJobs(currentJobs);
        const nextRender = await loadRender(selected.id);
        if (!isCurrent()) return;
        setRender(nextRender);
        if (chapterId) {
          const [nextAudio, nextSubtitle, nextTimeline] = await Promise.all([
            api<AudioAsset>(`/api/chapters/${chapterId}/audio`).catch(() => null),
            apiText(`/api/chapters/${chapterId}/subtitles`).catch(() => null),
            timelineApi.get(selected.id, chapterId).catch(() => null),
          ]);
          if (!isCurrent()) return;
          setTimeline(nextTimeline);
          setTimelineError('');
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
        const nextRenderConfig = await api<RenderConfig>(
          `/api/projects/${selected.id}/render-config`,
        );
        if (!isCurrent()) return;
        setRenderConfig(nextRenderConfig);
      } else {
        setStory(null);
        setAudio(null);
        setTimeline(null);
        setRenderPlan(null);
        setSubtitle(null);
      }
      if (!isCurrent()) return;
      setError('');
    } catch (cause) {
      if (!isCurrent()) return;
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
    window.localStorage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
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
    window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, detail.project.id);
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
  const rebuildTiming = async (): Promise<void> => {
    if (!selected || !activeChapter) return;
    const result = await timelineApi.buildTiming(selected.id, activeChapter.id);
    const ids = result.jobIds ?? (result.jobId ? [result.jobId] : []);
    await track(ids);
  };
  const rebuildMotion = async (): Promise<void> => {
    if (!selected || !activeChapter) return;
    const result = await timelineApi.buildMotion(selected.id, activeChapter.id);
    const ids = result.jobIds ?? (result.jobId ? [result.jobId] : []);
    await track(ids);
  };
  const saveTimelineTiming = async (input: SceneTimingUpdate): Promise<void> => {
    if (!selected || !activeChapter) return;
    const result = await timelineApi.saveTiming(selected.id, activeChapter.id, input);
    const ids = result.jobIds ?? (result.jobId ? [result.jobId] : []);
    await track(ids);
  };
  const saveTimelineMotion = async (sceneId: string, motion: MotionPlan): Promise<void> => {
    if (!selected || !activeChapter) return;
    await timelineApi.saveMotion(selected.id, activeChapter.id, sceneId, motion);
    await refresh();
  };
  const selectTimelineImage = async (
    sceneId: string,
    generationId: string,
    expectedSceneRevision: number,
  ): Promise<void> => {
    if (!selected) return;
    await imageApi.setCurrent(selected.id, sceneId, generationId, expectedSceneRevision);
    await refresh();
  };
  const loadTimelinePlan = async (input: TimelineRenderRequest): Promise<void> => {
    if (!selected) return;
    setRenderPlan(await timelineApi.plan(selected.id, input));
    setTimelineError('');
  };
  const renderTimeline = async (input: TimelineRenderRequest): Promise<void> => {
    if (!selected) return;
    const result = await timelineApi.render(selected.id, input);
    setRenderPlan(result.plan);
    await track(result.jobIds);
    await refresh();
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
                {[
                  'Story',
                  'Scenes',
                  'Visual Bible',
                  'Images',
                  'Timeline',
                  'Audio',
                  'Video',
                  'Render',
                  'Production',
                ].map((item) => (
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
            {(tab === 'Scenes' || tab === 'Images') && (
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
            {tab === 'Timeline' && (
              <TimelinePanel
                projectId={selected.id}
                chapters={chapters}
                chapter={activeChapter ?? null}
                timeline={timeline}
                jobs={jobs.filter(
                  (job) =>
                    job.type === 'BUILD_SCENE_TIMING' ||
                    job.type === 'BUILD_MOTION_PLAN' ||
                    job.type === 'RENDER_SCENE_CLIP' ||
                    job.type === 'RENDER_CHAPTER_VIDEO' ||
                    job.type === 'RENDER_PROJECT_VIDEO',
                )}
                renderPlan={renderPlan}
                timelineProgress={status?.timeline ?? null}
                renderConfig={renderConfig}
                render={render}
                error={timelineError}
                onError={setTimelineError}
                onBuildTiming={rebuildTiming}
                onBuildMotion={rebuildMotion}
                onSaveTiming={saveTimelineTiming}
                onSaveMotion={saveTimelineMotion}
                onSelectImage={selectTimelineImage}
                onPlan={loadTimelinePlan}
                onRender={renderTimeline}
                onRefresh={refresh}
                onUpdateRenderConfig={updateRenderConfig}
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
            {tab === 'Production' && (
              <ProductionWorkspace projectId={selected.id} request={api} onError={setError} />
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

type TimelinePanelProps = {
  projectId: string;
  chapter: ChapterDto | null;
  chapters: ChapterDto[];
  timeline: ChapterTimeline | null;
  jobs: JobDto[];
  timelineProgress: StatusSummary['timeline'];
  renderPlan: RenderPlan | null;
  renderConfig: RenderConfig | null;
  render: RenderAsset | null;
  error: string;
  onError: (message: string) => void;
  onBuildTiming: () => Promise<void>;
  onBuildMotion: () => Promise<void>;
  onSaveTiming: (input: SceneTimingUpdate) => Promise<void>;
  onSaveMotion: (sceneId: string, motion: MotionPlan) => Promise<void>;
  onSelectImage: (
    sceneId: string,
    generationId: string,
    expectedSceneRevision: number,
  ) => Promise<void>;
  onPlan: (input: TimelineRenderRequest) => Promise<void>;
  onRender: (input: TimelineRenderRequest) => Promise<void>;
  onRefresh: () => Promise<void>;
  onUpdateRenderConfig: (patch: Partial<RenderConfig>) => Promise<void>;
};

const timelineMotionTypes: MotionPlan['motionType'][] = [
  'STATIC',
  'ZOOM_IN',
  'ZOOM_OUT',
  'PAN_LEFT',
  'PAN_RIGHT',
  'PAN_UP',
  'PAN_DOWN',
  'PAN_ZOOM',
  'SLOW_PUSH_IN',
];
const motionSourceBadges: Record<MotionSource, string> = {
  KEN_BURNS: 'KB',
  AI_VIDEO: 'AI',
  HYBRID: 'HY',
};

function timelineTime(ms: number): string {
  return `${(ms / 1_000).toFixed(2)}s`;
}

function TimelinePanel({
  projectId,
  chapters,
  chapter,
  jobs,
  timeline,
  timelineProgress,
  renderPlan,
  renderConfig,
  render,
  error,
  onError,
  onBuildTiming,
  onBuildMotion,
  onSaveTiming,
  onSaveMotion,
  onSelectImage,
  onPlan,
  onRender,
  onRefresh,
  onUpdateRenderConfig,
}: TimelinePanelProps) {
  const [timingDraft, setTimingDraft] = useState<SceneTimingUpdate['items']>([]);
  const [timingEditing, setTimingEditing] = useState(false);
  const [motionDrafts, setMotionDrafts] = useState<Record<string, MotionPlan>>({});
  const [fallbackPolicy, setFallbackPolicy] =
    useState<TimelineRenderRequest['fallbackPolicy']>('FAIL');
  const [qualityPreset, setQualityPreset] =
    useState<NonNullable<TimelineRenderRequest['qualityPreset']>>('STANDARD');
  const [fitMode, setFitMode] = useState<NonNullable<TimelineRenderRequest['fitMode']>>('COVER');
  const [scope, setScope] = useState<TimelineRenderRequest['scope']['kind']>('CHAPTER');
  const [sceneScopeId, setSceneScopeId] = useState('');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [busy, setBusy] = useState('');
  const [imageOptions, setImageOptions] = useState<Record<string, SceneImageGenerationDto[]>>({});
  const [selectedImageIds, setSelectedImageIds] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!timeline) {
      setTimingDraft([]);
      setMotionDrafts({});
      setImageOptions({});
      setSelectedImageIds({});
      return;
    }
    setTimingDraft(
      timeline.items.map((item) => ({
        sceneId: item.sceneId,
        startMs: item.startMs,
        endMs: item.endMs,
      })),
    );
    setTimingEditing(timeline.mode === 'MANUAL');
    setMotionDrafts(
      Object.fromEntries(
        timeline.items.flatMap((item) =>
          item.motionPlan ? [[item.sceneId, item.motionPlan] as const] : [],
        ),
      ) as Record<string, MotionPlan>,
    );
  }, [timeline?.id, timeline?.fingerprint]);

  useEffect(() => {
    if (!chapter) {
      setSceneScopeId('');
      setSelectedChapterIds([]);
      return;
    }
    setRangeStart(chapter.number);
    setRangeEnd(chapter.number);
    setSelectedChapterIds([chapter.id]);
    setSceneScopeId(timeline?.items[0]?.sceneId ?? '');
  }, [chapter?.id, chapter?.number, timeline?.id]);

  useEffect(() => {
    if (!renderConfig) return;
    setQualityPreset(renderConfig.qualityPreset);
    setFitMode(renderConfig.fitMode);
  }, [renderConfig?.qualityPreset, renderConfig?.fitMode]);

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusy(name);
    try {
      await action();
      onError('');
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Thao tác Timeline thất bại');
    } finally {
      setBusy('');
    }
  };
  const loadImageOptions = async (sceneId: string): Promise<void> => {
    const options = await imageApi.list(projectId, sceneId);
    const validOptions = options.filter(
      (option) =>
        option.status === 'COMPLETED' &&
        option.assetId !== null &&
        option.reviewStatus !== 'REJECTED' &&
        option.freshness === 'CURRENT' &&
        option.productionReady,
    );
    setImageOptions((current) => ({ ...current, [sceneId]: validOptions }));
    const currentOption = validOptions.find((option) => option.isCurrent) ?? validOptions[0];
    if (currentOption) {
      setSelectedImageIds((current) => ({ ...current, [sceneId]: currentOption.id }));
    }
  };
  const request = (): TimelineRenderRequest | null => {
    if (scope === 'SCENE') {
      const sceneId = sceneScopeId || timeline?.items[0]?.sceneId;
      return sceneId
        ? {
            source: 'SCENES',
            scope: { kind: 'SCENE', sceneId },
            autoBuild: true,
            fallbackPolicy,
            qualityPreset,
            fitMode,
          }
        : null;
    }
    if (scope === 'CHAPTER') {
      return chapter
        ? {
            source: 'SCENES',
            scope: { kind: 'CHAPTER', chapterId: chapter.id },
            autoBuild: true,
            fallbackPolicy,
            qualityPreset,
            fitMode,
          }
        : null;
    }
    if (scope === 'CHAPTER_RANGE') {
      return rangeStart <= rangeEnd
        ? {
            source: 'SCENES',
            scope: {
              kind: 'CHAPTER_RANGE',
              startChapterNumber: rangeStart,
              endChapterNumber: rangeEnd,
            },
            autoBuild: true,
            fallbackPolicy,
            qualityPreset,
            fitMode,
          }
        : null;
    }
    if (scope === 'SELECTED_CHAPTERS') {
      return selectedChapterIds.length
        ? {
            source: 'SCENES',
            scope: { kind: 'SELECTED_CHAPTERS', chapterIds: selectedChapterIds },
            autoBuild: true,
            fallbackPolicy,
            qualityPreset,
            fitMode,
          }
        : null;
    }
    return {
      source: 'SCENES',
      scope: { kind: 'FULL_STORY' },
      autoBuild: true,
      fallbackPolicy,
      qualityPreset,
      fitMode,
    };
  };

  const saveTiming = (): Promise<void> => {
    if (!timeline || !timingEditing || timingDraftError) return Promise.resolve();
    return run('timing-save', () =>
      onSaveTiming({
        expectedRevision: timeline.timingRevision,
        mode: 'MANUAL',
        items: timingDraft,
      }),
    );
  };

  const updateTiming = (sceneId: string, field: 'startMs' | 'endMs', value: number): void => {
    setTimingDraft((current) =>
      current.map((item) => (item.sceneId === sceneId ? { ...item, [field]: value } : item)),
    );
  };

  const updateMotion = (sceneId: string, patch: Partial<MotionPlan>): void => {
    setMotionDrafts((current) => ({
      ...current,
      [sceneId]: { ...current[sceneId], ...patch } as MotionPlan,
    }));
  };

  const updateMotionPoint = (
    sceneId: string,
    field: 'startPosition' | 'endPosition',
    axis: 'x' | 'y',
    value: number,
  ): void => {
    const motion = motionDrafts[sceneId];
    if (!motion) return;
    updateMotion(sceneId, { [field]: { ...motion[field], [axis]: value } });
  };
  let timingDraftError = '';
  if (timeline && timingDraft.length > 0) {
    let cursor = 0;
    for (const item of timingDraft) {
      if (
        !Number.isInteger(item.startMs) ||
        !Number.isInteger(item.endMs) ||
        item.startMs !== cursor
      ) {
        timingDraftError = 'Các cảnh phải nối tiếp, không có khoảng trống hoặc chồng lấn.';
        break;
      }
      if (item.endMs <= item.startMs || item.endMs > timeline.durationMs) {
        timingDraftError = 'Mỗi cảnh phải có thời lượng dương và nằm trong thời lượng narration.';
        break;
      }
      cursor = item.endMs;
    }
    if (!timingDraftError && cursor !== timeline.durationMs)
      timingDraftError = 'Timing phải phủ kín toàn bộ narration của chương.';
  }

  const previewItem = timeline?.items[0] ?? null;
  const previewMotion = previewItem
    ? (motionDrafts[previewItem.sceneId] ?? previewItem.motionPlan)
    : null;
  const previewStyle = previewMotion
    ? ({
        '--timeline-start-transform': `translate(${(0.5 - previewMotion.startPosition.x) * 12}%, ${(0.5 - previewMotion.startPosition.y) * 12}%) scale(${previewMotion.startScale})`,
        '--timeline-end-transform': `translate(${(0.5 - previewMotion.endPosition.x) * 12}%, ${(0.5 - previewMotion.endPosition.y) * 12}%) scale(${previewMotion.endScale})`,
      } as CSSProperties)
    : undefined;
  const renderRequest = request();
  const planTimeline = (): void => {
    if (!renderRequest) return;
    void run('plan', () => onPlan(renderRequest));
  };
  const renderTimeline = (): void => {
    if (!renderRequest) return;
    void run('render', () => onRender(renderRequest));
  };

  return (
    <div className="timeline-workspace">
      <div className="panel timeline-toolbar">
        <div className="section-head">
          <div>
            <p className="eyebrow">SCENE TIMELINE</p>
            <h3>{chapter ? chapter.title : 'Chưa chọn chương'}</h3>
          </div>
          <button
            className="secondary"
            onClick={() => void run('refresh', onRefresh)}
            disabled={Boolean(busy)}
          >
            Làm mới
          </button>
        </div>
        <p className="muted">
          Timing lấy từ đoạn narration thực tế. Motion Plan chỉ điều khiển crop/pan bounded trong
          FFmpeg.
        </p>
        {error && <div className="error timeline-error">{error}</div>}
        {timelineProgress && (
          <div className="timeline-progress" role="status">
            <strong>{timelineProgress.stage}</strong>
            <span>{timelineProgress.status}</span>
            <span>{Math.round(timelineProgress.progress * 100)}%</span>
            {timelineProgress.error && <em>{timelineProgress.error}</em>}
            {timelineProgress.levels && timelineProgress.levels.length > 0 && (
              <div className="timeline-progress-levels">
                {timelineProgress.levels.map((level) => (
                  <span key={level.stage}>
                    {level.stage}: {level.completed}/{level.total}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {timeline && (
          <div className="timeline-lock" role="status">
            <strong>
              {timingEditing ? 'MANUAL - đang mở khóa' : `${timeline.mode} - đã khóa`}
            </strong>
            <button
              type="button"
              className="secondary"
              onClick={() => setTimingEditing((value) => !value)}
              disabled={Boolean(busy)}
            >
              {timingEditing ? 'Khóa timing' : 'Mở khóa timing'}
            </button>
          </div>
        )}
        {timingDraftError && <div className="error timeline-error">{timingDraftError}</div>}
        <div className="actions">
          <button
            onClick={() => void run('timing-build', onBuildTiming)}
            disabled={!chapter || Boolean(busy)}
          >
            {busy === 'timing-build' ? 'Đang dựng timing...' : 'Tạo Scene Timing tự động'}
          </button>
          <button
            className="secondary"
            onClick={() => void run('motion-build', onBuildMotion)}
            disabled={!timeline || Boolean(busy)}
          >
            {busy === 'motion-build' ? 'Đang dựng Motion...' : 'Tạo Motion Plan'}
          </button>
          <button
            className="secondary"
            onClick={() => void run('timing-save', saveTiming)}
            disabled={
              !timeline ||
              !timingDraft.length ||
              !timingEditing ||
              Boolean(timingDraftError) ||
              Boolean(busy)
            }
          >
            Lưu timing thủ công
          </button>
        </div>
      </div>

      {!chapter ? (
        <div className="placeholder">
          <h3>Chọn một chương để bắt đầu</h3>
          <p className="muted">
            Scene Timing và Motion Plan được lưu riêng theo từng revision của chương.
          </p>
        </div>
      ) : !timeline ? (
        <div className="placeholder">
          <h3>Chưa có Scene Timing</h3>
          <p className="muted">Tạo narration trước, sau đó dựng timing tự động từ source range.</p>
        </div>
      ) : (
        <>
          <div className="timeline-summary">
            <span>{timeline.items.length} scenes</span>
            <span>{timelineTime(timeline.durationMs)} narration</span>
            <span>Revision {timeline.timingRevision}</span>
            <span className={timeline.warnings.length ? 'timeline-warning' : ''}>
              {timeline.warnings.length ? `${timeline.warnings.length} cảnh báo` : 'Timing hợp lệ'}
            </span>
          </div>

          <div className="timeline-preview-grid">
            <div className="panel timeline-preview-panel">
              <div className="section-head">
                <h3>Preview chuyển động</h3>
                <button
                  className="secondary"
                  onClick={() => setPreviewPlaying((value) => !value)}
                  disabled={!previewMotion}
                >
                  {previewPlaying ? 'Dừng preview' : 'Chạy preview'}
                </button>
              </div>
              <div className="timeline-preview-frame">
                {previewItem?.imageAssetUrl ? (
                  <img
                    className={`timeline-preview-image ${previewPlaying ? 'playing' : ''}`}
                    src={
                      previewItem.imageAssetUrl.startsWith('http')
                        ? previewItem.imageAssetUrl
                        : `${API_BASE}${previewItem.imageAssetUrl}`
                    }
                    alt={`Preview scene ${previewItem.sceneNumber}`}
                    style={previewStyle}
                  />
                ) : (
                  <div className="timeline-preview-black">BLACK / fallback</div>
                )}
              </div>
              <p className="muted">
                {previewItem
                  ? `Scene ${previewItem.sceneNumber} · ${previewMotion?.motionType ?? 'Chưa có Motion Plan'}`
                  : 'Chưa có scene'}
              </p>
            </div>
            <div className="panel timeline-render-panel">
              <h3>Render timeline</h3>
              <div className="timeline-controls">
                <label>
                  Phạm vi
                  <select
                    value={scope}
                    onChange={(event) => setScope(event.target.value as typeof scope)}
                  >
                    <option value="SCENE">Một Scene</option>
                    <option value="CHAPTER">Chương hiện tại</option>
                    <option value="CHAPTER_RANGE">Khoảng chương</option>
                    <option value="SELECTED_CHAPTERS">Các chương đã chọn</option>
                    <option value="FULL_STORY">Toàn bộ Story</option>
                  </select>
                </label>
                {scope === 'SCENE' && (
                  <label>
                    Scene
                    <select
                      value={sceneScopeId}
                      onChange={(event) => setSceneScopeId(event.target.value)}
                    >
                      {timeline.items.map((item) => (
                        <option key={item.sceneId} value={item.sceneId}>
                          Scene {item.sceneNumber} - {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {scope === 'CHAPTER_RANGE' && (
                  <>
                    <label>
                      Từ chương
                      <input
                        type="number"
                        min={1}
                        value={rangeStart}
                        onChange={(event) => setRangeStart(Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Đến chương
                      <input
                        type="number"
                        min={rangeStart}
                        value={rangeEnd}
                        onChange={(event) => setRangeEnd(Number(event.target.value))}
                      />
                    </label>
                  </>
                )}
                {scope === 'SELECTED_CHAPTERS' && (
                  <label>
                    Chọn chương
                    <select
                      multiple
                      size={Math.min(5, Math.max(2, chapters.length))}
                      value={selectedChapterIds}
                      onChange={(event) =>
                        setSelectedChapterIds(
                          Array.from(event.target.selectedOptions, (option) => option.value),
                        )
                      }
                    >
                      {chapters.map((option) => (
                        <option key={option.id} value={option.id}>
                          Chương {option.number} - {option.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Fallback
                  <select
                    value={fallbackPolicy}
                    onChange={(event) =>
                      setFallbackPolicy(
                        event.target.value as TimelineRenderRequest['fallbackPolicy'],
                      )
                    }
                  >
                    <option value="FAIL">FAIL - dừng khi thiếu ảnh</option>
                    <option value="HOLD_PREVIOUS">HOLD_PREVIOUS - giữ ảnh cũ</option>
                    <option value="BLACK">BLACK - chèn khung đen</option>
                    <option value="PROJECT_BACKGROUND">PROJECT_BACKGROUND - dùng nền dự án</option>
                  </select>
                </label>
                <label>
                  Quality
                  <select
                    value={qualityPreset}
                    onChange={(event) =>
                      setQualityPreset(
                        event.target.value as NonNullable<TimelineRenderRequest['qualityPreset']>,
                      )
                    }
                  >
                    <option value="FAST_PREVIEW">Fast preview</option>
                    <option value="STANDARD">Standard</option>
                    <option value="HIGH">High</option>
                  </select>
                </label>
                <label>
                  Fit
                  <select
                    value={fitMode}
                    onChange={(event) =>
                      setFitMode(
                        event.target.value as NonNullable<TimelineRenderRequest['fitMode']>,
                      )
                    }
                  >
                    <option value="COVER">Cover</option>
                    <option value="CONTAIN">Contain</option>
                  </select>
                </label>
                <label>
                  Chuyển cảnh
                  <select
                    value={renderConfig?.transition ?? 'CUT'}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      const transition = event.target.value as RenderConfig['transition'];
                      void run('config', () =>
                        onUpdateRenderConfig({
                          transition,
                          transitionDurationMs:
                            transition === 'CUT'
                              ? 0
                              : Math.max(renderConfig?.transitionDurationMs ?? 600, 300),
                        }),
                      );
                    }}
                  >
                    <option value="CUT">CUT</option>
                    <option value="CROSSFADE">CROSSFADE</option>
                    <option value="FADE">FADE</option>
                  </select>
                </label>
                <label>
                  Thời lượng chuyển cảnh (ms)
                  <input
                    type="number"
                    min={renderConfig?.transition === 'CUT' ? 0 : 300}
                    max={800}
                    step={50}
                    value={renderConfig?.transitionDurationMs ?? 0}
                    disabled={!renderConfig || renderConfig.transition === 'CUT' || Boolean(busy)}
                    onChange={(event) =>
                      void run('config', () =>
                        onUpdateRenderConfig({ transitionDurationMs: Number(event.target.value) }),
                      )
                    }
                  />
                </label>
              </div>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!renderRequest || Boolean(busy)}
                  onClick={planTimeline}
                >
                  {busy === 'plan' ? 'Đang lập kế hoạch...' : 'Lập RenderPlan'}
                </button>
                <button disabled={!renderRequest || Boolean(busy)} onClick={renderTimeline}>
                  {busy === 'render' ? 'Đang xếp hàng render...' : 'Render timeline MP4'}
                </button>
              </div>
              {renderPlan && (
                <div className="timeline-plan">
                  <div className="timeline-plan-grid">
                    <span>
                      Scene: {renderPlan.scenes.reusable}/{renderPlan.scenes.total} dùng lại
                    </span>
                    <span>
                      Chapter: {renderPlan.chapters.reusable}/{renderPlan.chapters.total} dùng lại
                    </span>
                    <span>
                      {renderPlan.project.reusable
                        ? 'Project video dùng lại'
                        : 'Project video sẽ dựng mới'}
                    </span>
                    <span>
                      Dự kiến:{' '}
                      {renderPlan.expectedDurationMs
                        ? timelineTime(renderPlan.expectedDurationMs)
                        : 'chưa biết'}
                    </span>
                    {renderPlan.ai && (
                      <span>
                        AI: {renderPlan.ai.scenesSelected} cảnh chọn / {renderPlan.ai.missingMotion}{' '}
                        thiếu motion / {renderPlan.ai.clipsToNormalize} cần ghép; ước lượng ~
                        {renderPlan.ai.estimatedGenerations} video (
                        {renderPlan.ai.estimatedGenerationMs != null
                          ? timelineTime(renderPlan.ai.estimatedGenerationMs)
                          : 'chưa có dữ liệu'}
                        )
                      </span>
                    )}
                  </div>
                  {renderPlan.blockers.length > 0 && (
                    <ul className="timeline-blockers">
                      {renderPlan.blockers.map((blocker) => (
                        <li key={`${blocker.code}-${blocker.entityId ?? 'project'}`}>
                          <strong>{blocker.code}</strong>: {blocker.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {render && <video className="video" controls preload="metadata" src={render.url} />}
            </div>
          </div>

          <div className="timeline-scene-list">
            {timeline.items.map((item, index) => {
              const timing = timingDraft[index] ?? {
                sceneId: item.sceneId,
                startMs: item.startMs,
                endMs: item.endMs,
              };
              const motion = motionDrafts[item.sceneId] ?? item.motionPlan;
              const options = imageOptions[item.sceneId];
              const selectedImageId = selectedImageIds[item.sceneId] ?? '';
              return (
                <article className="panel timeline-scene" key={item.sceneId}>
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">
                        SCENE {item.sceneNumber}
                        <span className="status-chip">{motionSourceBadges[item.motionSource]}</span>
                        {item.aiMotion && (
                          <span
                            className={`status-chip status-${item.aiMotion.status.toLowerCase()}`}
                          >
                            {item.aiMotion.status}
                            {item.aiMotion.hasAcceptedClip ? ' ✓' : ''}
                          </span>
                        )}
                      </p>
                      <h3>
                        {timelineTime(item.startMs)} - {timelineTime(item.endMs)}
                      </h3>
                    </div>
                    <span
                      className={
                        item.blockers.length ? 'timeline-status blocked' : 'timeline-status'
                      }
                    >
                      {item.blockers.length ? 'Cần xử lý' : 'Sẵn sàng'}
                    </span>
                  </div>
                  <div className="timeline-scene-grid">
                    <div>
                      <div className="timeline-scene-visual">
                        {item.imageAssetUrl ? (
                          <img
                            src={
                              item.imageAssetUrl.startsWith('http')
                                ? item.imageAssetUrl
                                : `${API_BASE}${item.imageAssetUrl}`
                            }
                            alt={`Ảnh hiện tại của Scene ${item.sceneNumber}`}
                          />
                        ) : (
                          <div className="timeline-scene-missing">
                            {item.blockers.includes('SCENE_IMAGE_REQUIRED')
                              ? 'Thiếu ảnh hiện tại'
                              : 'Đang dùng fallback'}
                          </div>
                        )}
                      </div>
                      {item.sceneClipAssetUrl && (
                        <video
                          className="video"
                          controls
                          preload="metadata"
                          src={
                            item.sceneClipAssetUrl.startsWith('http')
                              ? item.sceneClipAssetUrl
                              : `${API_BASE}${item.sceneClipAssetUrl}`
                          }
                        />
                      )}
                      <div className="timeline-image-picker">
                        <button
                          className="secondary"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run(`images-${item.sceneId}`, () => loadImageOptions(item.sceneId))
                          }
                        >
                          {busy === `images-${item.sceneId}`
                            ? 'Đang tải ảnh...'
                            : 'Chọn ảnh hiện tại'}
                        </button>
                        {options &&
                          (options.length > 0 ? (
                            <>
                              <label>
                                Ảnh hợp lệ
                                <select
                                  value={selectedImageId}
                                  disabled={Boolean(busy)}
                                  onChange={(event) =>
                                    setSelectedImageIds((current) => ({
                                      ...current,
                                      [item.sceneId]: event.target.value,
                                    }))
                                  }
                                >
                                  {options.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.isCurrent ? 'Đang chọn - ' : ''}
                                      Bản {option.revision} · {option.source}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                className="secondary"
                                disabled={!selectedImageId || Boolean(busy)}
                                onClick={() => {
                                  const option = options.find(
                                    (candidate) => candidate.id === selectedImageId,
                                  );
                                  if (!option) return;
                                  void run(`image-select-${item.sceneId}`, () =>
                                    onSelectImage(item.sceneId, option.id, item.sceneRevision),
                                  );
                                }}
                              >
                                {busy === `image-select-${item.sceneId}`
                                  ? 'Đang chọn...'
                                  : 'Dùng ảnh này'}
                              </button>
                            </>
                          ) : (
                            <span className="muted">Không có ảnh hoàn tất hợp lệ.</span>
                          ))}
                      </div>
                      <h4>{item.title}</h4>
                      <p className="timeline-source-excerpt">
                        {item.sourceExcerpt || 'Không có trích đoạn nguồn.'}
                      </p>
                      <p className="muted">
                        Source chars: {item.sourceRange.start} - {item.sourceRange.end} ·{' '}
                        {item.transition}
                      </p>
                      <div className="timeline-timing-inputs">
                        <label>
                          Bắt đầu (ms)
                          <input
                            type="number"
                            min={0}
                            value={timing.startMs}
                            disabled={!timingEditing || Boolean(busy)}
                            onChange={(event) =>
                              updateTiming(item.sceneId, 'startMs', Number(event.target.value))
                            }
                          />
                        </label>
                        <label>
                          Kết thúc (ms)
                          <input
                            type="number"
                            min={1}
                            value={timing.endMs}
                            disabled={!timingEditing || Boolean(busy)}
                            onChange={(event) =>
                              updateTiming(item.sceneId, 'endMs', Number(event.target.value))
                            }
                          />
                        </label>
                      </div>
                      {item.blockers.length > 0 && (
                        <ul className="timeline-blockers">
                          {item.blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="timeline-motion-editor">
                      <div className="section-head">
                        <strong>Motion Plan</strong>
                        <button
                          className="secondary"
                          disabled={!motion || Boolean(busy)}
                          onClick={() =>
                            motion &&
                            void run(`motion-save-${item.sceneId}`, () =>
                              onSaveMotion(item.sceneId, motion),
                            )
                          }
                        >
                          {busy === `motion-save-${item.sceneId}` ? 'Đang lưu...' : 'Lưu Motion'}
                        </button>
                      </div>
                      {motion ? (
                        <>
                          <div className="timeline-motion-fields">
                            <label>
                              Kiểu chuyển động
                              <select
                                value={motion.motionType}
                                onChange={(event) =>
                                  updateMotion(item.sceneId, {
                                    motionType: event.target.value as MotionPlan['motionType'],
                                  })
                                }
                              >
                                {timelineMotionTypes.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Easing
                              <select
                                value={motion.easing}
                                onChange={(event) =>
                                  updateMotion(item.sceneId, {
                                    easing: event.target.value as MotionPlan['easing'],
                                  })
                                }
                              >
                                <option value="LINEAR">Linear</option>
                                <option value="EASE_IN_OUT">Ease in/out</option>
                              </select>
                            </label>
                            <label>
                              Intensity
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={motion.intensity}
                                onChange={(event) =>
                                  updateMotion(item.sceneId, {
                                    intensity: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Scale đầu
                              <input
                                type="number"
                                min={1}
                                max={1.25}
                                step={0.01}
                                value={motion.startScale}
                                onChange={(event) =>
                                  updateMotion(item.sceneId, {
                                    startScale: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Scale cuối
                              <input
                                type="number"
                                min={1}
                                max={1.25}
                                step={0.01}
                                value={motion.endScale}
                                onChange={(event) =>
                                  updateMotion(item.sceneId, {
                                    endScale: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <div className="timeline-point-fields">
                            {(['startPosition', 'endPosition'] as const).map((field) => (
                              <label key={field}>
                                {field === 'startPosition' ? 'Vị trí đầu' : 'Vị trí cuối'} (x, y)
                                <span className="timeline-point-inputs">
                                  <input
                                    type="number"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={motion[field].x}
                                    aria-label={`${field} x`}
                                    onChange={(event) =>
                                      updateMotionPoint(
                                        item.sceneId,
                                        field,
                                        'x',
                                        Number(event.target.value),
                                      )
                                    }
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={motion[field].y}
                                    aria-label={`${field} y`}
                                    onChange={(event) =>
                                      updateMotionPoint(
                                        item.sceneId,
                                        field,
                                        'y',
                                        Number(event.target.value),
                                      )
                                    }
                                  />
                                </span>
                              </label>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="muted">Chưa có Motion Plan. Bấm “Tạo Motion Plan”.</p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      {jobs.length > 0 && (
        <div className="panel timeline-jobs">
          <div className="section-head">
            <div>
              <p className="eyebrow">TIMELINE JOBS</p>
              <h3>Render và xử lý nền</h3>
            </div>
          </div>
          <JobList jobs={jobs} onChanged={() => void onRefresh()} />
        </div>
      )}
    </div>
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
          characterProjectId={projectId}
          onRefreshed={() => run(async () => undefined)}
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

function CharacterReferenceStrip({
  projectId,
  characterId,
  profileRevision,
  onChanged,
}: {
  projectId: string;
  characterId: string;
  profileRevision: number | null;
  onChanged: () => void;
}) {
  const [references, setReferences] = useState<CharacterReferenceItem[] | null>(null);
  const [generated, setGenerated] = useState<VisualReferenceGeneration[]>([]);
  const load = async (): Promise<void> => {
    try {
      const [response, candidates] = await Promise.all([
        imageApi.references(projectId, characterId),
        visualReferenceApi.list(projectId, 'CHARACTER_PROTOTYPE', characterId),
      ]);
      setReferences(response.references);
      setGenerated(candidates);
    } catch {
      setReferences([]);
      setGenerated([]);
    }
  };
  useEffect(() => {
    void load();
  }, [projectId, characterId, profileRevision]);
  useEffect(() => {
    if (!generated.some((item) => item.status === 'PENDING' || item.status === 'RUNNING')) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [projectId, characterId, generated]);
  const generatePrototype = async (): Promise<void> => {
    try {
      await visualReferenceApi.generate(projectId, 'CHARACTER_PROTOTYPE', characterId);
      await load();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Không thể tạo ảnh nguyên mẫu');
    }
  };
  const reviewGenerated = async (
    generationId: string,
    approval: 'APPROVED' | 'REJECTED',
  ): Promise<void> => {
    try {
      await visualReferenceApi.review(projectId, generationId, approval);
      await load();
      onChanged();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Không thể duyệt ảnh nguyên mẫu');
    }
  };
  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      await imageApi.uploadReference(projectId, characterId, file);
      await load();
      onChanged();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Không thể tải ảnh tham chiếu');
    }
  };
  const setApproval = async (
    assetId: string,
    approval: 'CANDIDATE' | 'APPROVED' | 'REJECTED',
  ): Promise<void> => {
    try {
      await imageApi.setReferenceApproval(projectId, characterId, assetId, approval);
      await load();
      onChanged();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Không thể đổi trạng thái tham chiếu');
    }
  };
  const reorder = async (referenceAssetIds: string[]): Promise<void> => {
    if (!profileRevision) {
      window.alert('Hồ sơ nhân vật chưa tồn tại.');
      return;
    }
    try {
      await imageApi.setProfileReferences(
        projectId,
        characterId,
        profileRevision,
        referenceAssetIds,
      );
      await load();
      onChanged();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Không thể cập nhật tham chiếu hồ sơ');
    }
  };
  const attached = (references ?? []).filter((item) => item.attached);
  const setPrimary = (assetId: string): Promise<void> =>
    reorder([assetId, ...attached.filter((item) => item.id !== assetId).map((item) => item.id)]);
  const remove = (assetId: string): Promise<void> =>
    reorder(attached.filter((item) => item.id !== assetId).map((item) => item.id));
  return (
    <div className="character-reference-strip">
      <span className="field-label">Ảnh tham chiếu nhân vật</span>
      <p className="muted">
        Ảnh đầu tiên được duyệt là tham chiếu chính dùng cho conditioning. Chỉ ảnh APPROVED mới gắn
        được vào hồ sơ.
      </p>
      <div className="reference-grid">
        {(references ?? []).map((item) => (
          <figure
            key={item.id}
            className={`reference-item approval-${item.approval.toLowerCase()}`}
          >
            <img src={`${API_BASE}${item.url}`} alt={item.displayName || 'Ảnh tham chiếu'} />
            <figcaption>
              <span
                className={`status-chip ${item.approval === 'APPROVED' ? 'status-current' : 'status-warn'}`}
              >
                {item.approval}
                {item.isPrimary ? ' · chính' : item.attached ? ' · phụ' : ''}
              </span>
              <div className="actions">
                {item.approval !== 'APPROVED' && (
                  <button type="button" onClick={() => void setApproval(item.id, 'APPROVED')}>
                    Duyệt
                  </button>
                )}
                {item.approval !== 'REJECTED' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void setApproval(item.id, 'REJECTED')}
                  >
                    Từ chối
                  </button>
                )}
                {item.attached && !item.isPrimary && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void setPrimary(item.id)}
                  >
                    Đặt chính
                  </button>
                )}
                {item.attached && (
                  <button type="button" className="secondary" onClick={() => void remove(item.id)}>
                    Gỡ khỏi hồ sơ
                  </button>
                )}
              </div>
            </figcaption>
          </figure>
        ))}
        {references !== null && references.length === 0 && (
          <span className="muted">Chưa có ảnh tham chiếu.</span>
        )}
      </div>
      <div className="reference-grid">
        {generated.map((item) => (
          <figure
            key={item.id}
            className={`reference-item approval-${item.approval.toLowerCase()}`}
          >
            {item.assetId ? (
              <img src={`${API_BASE}/api/assets/${item.assetId}`} alt="Ảnh nguyên mẫu tự động" />
            ) : (
              <div className="scene-image-empty">{item.status}</div>
            )}
            <figcaption>
              <span className="status-chip">
                Nguyên mẫu - {item.status} - {item.approval}
              </span>
              {item.status === 'COMPLETED' && item.approval === 'CANDIDATE' && (
                <div className="actions">
                  <button type="button" onClick={() => void reviewGenerated(item.id, 'APPROVED')}>
                    Duyệt
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void reviewGenerated(item.id, 'REJECTED')}
                  >
                    Từ chối
                  </button>
                </div>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      <button type="button" onClick={() => void generatePrototype()} disabled={!profileRevision}>
        Tạo nguyên mẫu tự động
      </button>
      <label className="button secondary upload-button">
        Tải ảnh tham chiếu
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function VisualProfileCard({
  title,
  candidates,
  onGenerate,
  onSave,
  onApprove,
  characterProjectId,
  onRefreshed,
}: {
  title: string;
  candidates: Array<{ id: string; title: string; profile: VisualProfileRecord | null }>;
  onGenerate: (id: string, instructions: string) => Promise<void>;
  onSave: (id: string, profile: Record<string, unknown>) => Promise<void>;
  onApprove: (id: string, revision: number) => Promise<void>;
  characterProjectId?: string;
  onRefreshed?: () => Promise<void>;
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
            characterProjectId={characterProjectId}
            onRefreshed={onRefreshed}
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
  characterProjectId,
  onRefreshed,
}: {
  id: string;
  title: string;
  profile: VisualProfileRecord | null;
  onGenerate: (id: string, instructions: string) => Promise<void>;
  onSave: (id: string, profile: Record<string, unknown>) => Promise<void>;
  onApprove: (id: string, revision: number) => Promise<void>;
  characterProjectId?: string;
  onRefreshed?: () => Promise<void>;
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
      {characterProjectId && profile && onRefreshed && (
        <CharacterReferenceStrip
          projectId={characterProjectId}
          characterId={id}
          profileRevision={profile.revision}
          onChanged={() => void onRefreshed()}
        />
      )}
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
  const [shotPlan, setShotPlan] = useState<ShotPlanDto | null>(null);
  const [imageSettings, setImageSettings] = useState<ImageGenerationSettingsDto | null>(null);
  const [imageReadiness, setImageReadiness] = useState<ImageReadiness | null>(null);
  const [sceneImages, setSceneImages] = useState<SceneImageGenerationDto[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [imageInstructions, setImageInstructions] = useState('');
  const [imageModeOverride, setImageModeOverride] = useState<
    '' | 'TEXT_ONLY' | 'REFERENCE_CONDITIONED'
  >('');
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [promoteCharacterId, setPromoteCharacterId] = useState('');
  const [showImageSettings, setShowImageSettings] = useState(false);
  const [density, setDensity] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [targetMin, setTargetMin] = useState('');
  const [targetMax, setTargetMax] = useState('');
  const [candidateCount, setCandidateCount] = useState(1);
  const [reviewDraft, setReviewDraft] = useState<{
    generationId: string | null;
    scores: Record<string, number>;
    issues: string[];
    notes: string;
  }>({ generationId: null, scores: {}, issues: [], notes: '' });
  const scoreCategories = [
    'IDENTITY',
    'PROMPT_ADHERENCE',
    'COMPOSITION',
    'POSE_ACTION',
    'LOCATION',
    'IMPORTANT_OBJECTS',
    'STYLE',
    'ARTIFACTS',
    'OVERALL',
  ] as const;
  const issueTags = [
    'WRONG_FACE',
    'WRONG_HAIR',
    'WRONG_CLOTHING',
    'WRONG_POSE',
    'WRONG_COMPOSITION',
    'WRONG_CAMERA',
    'WRONG_LOCATION',
    'MISSING_OBJECT',
    'EXTRA_OBJECT',
    'DUPLICATE_OBJECT',
    'BAD_HANDS',
    'BAD_TEXT',
    'STYLE_DRIFT',
    'REFERENCE_POSE_BLEED',
    'OTHER',
  ] as const;
  const videoIssueTags = [
    'IDENTITY_DRIFT',
    'FACE_DISTORTION',
    'BODY_DISTORTION',
    'EXTRA_LIMBS',
    'MOTION_TOO_STRONG',
    'MOTION_TOO_WEAK',
    'CAMERA_WRONG',
    'OBJECT_MORPHING',
    'BACKGROUND_MORPHING',
    'FLICKER',
    'LOOP_BAD',
    'OTHER',
  ] as const;
  const [style, setStyle] = useState<VisualStyleSettingsDto | null>(null);
  const [styleForm, setStyleForm] = useState<SceneStyleForm>(defaultSceneStyleForm);
  const [showStyle, setShowStyle] = useState(false);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [sceneFailedJob, setSceneFailedJob] = useState<JobDto | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sceneJobIds, setSceneJobIds] = useState<string[]>([]);
  const [aiMotion, setAiMotion] = useState<AiMotionStateDto | null>(null);
  const [motionPlanDraft, setMotionPlanDraft] = useState<{
    characterAction: string;
    environmentMotion: string;
    intensity: AiMotionIntensity;
  }>({ characterAction: '', environmentMotion: '', intensity: 'SUBTLE' });
  const [videoInstructions, setVideoInstructions] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [videoReadiness, setVideoReadiness] = useState<VideoReadiness | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoGenerationSettingsDto | null>(null);
  const [videoReviewDraft, setVideoReviewDraft] = useState<{
    generationId: string | null;
    issues: string[];
    notes: string;
  }>({ generationId: null, issues: [], notes: '' });
  const [videoJobIds, setVideoJobIds] = useState<string[]>([]);

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
      const [nextLocations, nextImageSettings] = await Promise.all([
        sceneApi.locations(projectId),
        imageApi.settings(projectId),
      ]);
      setLocations(nextLocations);
      setImageSettings(nextImageSettings);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu cảnh');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void videoApi
      .settings(projectId)
      .then(setVideoSettings)
      .catch((cause) =>
        onError(cause instanceof Error ? cause.message : 'Không thể tải cấu hình video'),
      );
  }, [projectId]);

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
      setShotPlan(null);
      setSceneImages([]);
      setSelectedImageId(null);
      setAiMotion(null);
      setSelectedVideoId(null);
      return;
    }
    const selectedScene = sceneList.find((scene) => scene.id === selectedSceneId);
    if (selectedScene) {
      void Promise.all([
        sceneApi.get(projectId, selectedScene.id),
        visualApi.scenePackage(projectId, selectedScene.id).catch(() => null),
        shotApi.current(projectId, selectedScene.id).catch(() => null),
        imageApi.list(projectId, selectedScene.id),
        videoApi.aiMotion(projectId, selectedScene.id).catch(() => null),
      ])
        .then(([nextDraft, nextPackage, nextShotPlan, nextImages, nextMotion]) => {
          setDraft(nextDraft);
          setScenePackage(nextPackage);
          setShotPlan(nextShotPlan);
          setSceneImages(nextImages);
          setSelectedImageId((current) =>
            current && nextImages.some((image) => image.id === current)
              ? current
              : (nextImages.find((image) => image.isCurrent)?.id ?? nextImages[0]?.id ?? null),
          );
          setAiMotion(nextMotion);
          if (nextMotion?.motionPlan) {
            setMotionPlanDraft({
              characterAction: nextMotion.motionPlan.intent.characterAction,
              environmentMotion: nextMotion.motionPlan.intent.environmentMotion,
              intensity: nextMotion.motionPlan.intent.intensity,
            });
          }
        })
        .catch((cause) =>
          onError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết cảnh'),
        );
    }
  }, [projectId, selectedSceneId, sceneList]);

  const generateShotPlan = async (): Promise<void> => {
    if (!draft) return;
    try {
      const scheduled = await shotApi.generate(
        projectId,
        draft.id,
        draft.revision,
        Boolean(shotPlan),
      );
      if (scheduled.jobId)
        setSceneJobIds((current) => [...new Set([...current, scheduled.jobId!])]);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lập kế hoạch shot');
    }
  };

  const reviewShotPlan = async (status: 'APPROVED' | 'REJECTED'): Promise<void> => {
    if (!shotPlan) return;
    try {
      setShotPlan(await shotApi.review(projectId, shotPlan.id, status, shotPlan.rowVersion));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể duyệt kế hoạch shot');
    }
  };
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
          await loadScenes();
          if (selectedSceneId) {
            setSceneImages(await imageApi.list(projectId, selectedSceneId));
            setShotPlan(await shotApi.current(projectId, selectedSceneId).catch(() => null));
          }
          onChanged();
          const failed = jobs.find((job) => job.status === 'FAILED');
          if (failed) setSceneFailedJob(failed);
          if (failed?.error) onError(failed.error);
        }
      } catch (cause) {
        if (!disposed) onError(cause instanceof Error ? cause.message : 'Không thể theo dõi job');
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [projectId, sceneJobIds, selectedSceneId]);
  useEffect(() => {
    if (!videoJobIds.length) return;
    let disposed = false;
    const poll = async (): Promise<void> => {
      try {
        const jobs = await Promise.all(
          videoJobIds.map((jobId) => api<JobDto>(`/api/jobs/${jobId}`)),
        );
        const finished = jobs.some((job) =>
          ['COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED'].includes(job.status),
        );
        if (!disposed && finished) {
          setVideoJobIds((current) =>
            current.filter(
              (jobId) =>
                !jobs.some(
                  (job) =>
                    job.id === jobId &&
                    ['COMPLETED', 'FAILED', 'CANCELLED', 'INVALIDATED'].includes(job.status),
                ),
            ),
          );
          if (selectedSceneId) setAiMotion(await videoApi.aiMotion(projectId, selectedSceneId));
          onChanged();
          const failed = jobs.find((job) => job.status === 'FAILED');
          if (failed?.error) onError(failed.error);
        }
      } catch (cause) {
        if (!disposed)
          onError(cause instanceof Error ? cause.message : 'Không thể theo dõi job video AI');
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [projectId, videoJobIds, selectedSceneId]);

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
  const queueImage = (result: ImageScheduleDto): void => {
    setSceneImages((current) => [
      result.generation,
      ...current.filter((item) => item.id !== result.generation.id),
    ]);
    setSelectedImageId(result.generation.id);
    setSceneJobIds((current) => [...new Set([...current, result.jobId])]);
  };
  const saveImageSettings = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!imageSettings) return;
    try {
      const saved = await imageApi.saveSettings(projectId, {
        provider: imageSettings.provider,
        baseUrl: imageSettings.baseUrl,
        workflowTemplate: imageSettings.workflowTemplate,
        diffusionModel: imageSettings.diffusionModel,
        textEncoder: imageSettings.textEncoder,
        vaeName: imageSettings.vaeName,
        sampler: imageSettings.sampler,
        connectionTimeoutMs: imageSettings.connectionTimeoutMs,
        generationTimeoutMs: imageSettings.generationTimeoutMs,
        width: imageSettings.width,
        height: imageSettings.height,
        steps: imageSettings.steps,
        guidance: imageSettings.guidance,
        seedMode: imageSettings.seedMode,
        fixedSeed: imageSettings.fixedSeed,
        expectedRowVersion: imageSettings.rowVersion,
      });
      setImageSettings(saved);
      setImageReadiness(null);
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu cài đặt tạo ảnh');
    }
  };
  const checkImageReadiness = async (): Promise<void> => {
    try {
      setImageReadiness(await imageApi.readiness(projectId));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể kiểm tra ComfyUI');
    }
  };
  const generateSceneImage = async (): Promise<void> => {
    if (!draft) return;
    if (!scenePackage) {
      onError('Cảnh chưa có Visual Prompt Package hiện hành.');
      return;
    }

    try {
      queueImage(
        await imageApi.generate(
          projectId,
          draft.id,
          imageInstructions.trim(),
          imageModeOverride || undefined,
          candidateCount,
        ),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lên lịch tạo ảnh');
    }
  };
  const regenerateImage = async (
    generationId: string,
    mode: 'SAME_SEED' | 'NEW_SEED',
    useReviewFeedback = false,
  ): Promise<void> => {
    if (!draft) return;
    try {
      queueImage(
        await imageApi.regenerate(
          projectId,
          draft.id,
          generationId,
          mode,
          imageModeOverride || undefined,
          useReviewFeedback,
        ),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo lại ảnh');
    }
  };
  const reviewImage = async (
    generationId: string,
    status: 'REJECTED' | 'UNREVIEWED',
    scores: Record<string, number> = {},
    issues: string[] = [],
    notes = '',
  ): Promise<void> => {
    if (!draft) return;
    try {
      const saved = await imageApi.review(
        projectId,
        draft.id,
        generationId,
        status,
        notes,
        scores,
        issues,
      );
      setSceneImages((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu đánh giá ảnh');
    }
  };
  const promoteDisplayedImage = async (): Promise<void> => {
    if (!draft || !displayedImage) return;
    if (!promoteCharacterId) {
      onError('Chọn nhân vật để gắn ảnh làm tham chiếu.');
      return;
    }
    try {
      const refs = await imageApi.references(projectId, promoteCharacterId);
      if (!refs.profileRevision) {
        onError('Nhân vật chưa có hồ sơ Visual Bible để gắn tham chiếu.');
        return;
      }
      await imageApi.promoteReference(
        projectId,
        draft.id,
        displayedImage.id,
        promoteCharacterId,
        refs.profileRevision,
        true,
      );
      if (selectedSceneId) setSceneImages(await imageApi.list(projectId, selectedSceneId));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể chuyển ảnh thành tham chiếu');
    }
  };
  const acceptImage = async (generationId: string): Promise<void> => {
    if (!draft) return;
    try {
      await imageApi.accept(projectId, draft.id, generationId);
      setSceneImages(await imageApi.list(projectId, draft.id));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể chấp nhận ảnh');
    }
  };
  const selectCurrentImage = async (generationId: string): Promise<void> => {
    if (!draft) return;
    try {
      await imageApi.setCurrent(projectId, draft.id, generationId, draft.revision);
      setSceneImages(await imageApi.list(projectId, draft.id));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể chọn ảnh hiện hành');
    }
  };
  const uploadSceneImage = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!draft || !file) return;
    try {
      await imageApi.upload(projectId, draft.id, file);
      setSceneImages(await imageApi.list(projectId, draft.id));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tải ảnh thủ công');
    }
  };
  const generateChapterImages = async (): Promise<void> => {
    if (!selectedChapterId) return;
    try {
      const result = await imageApi.chapterBatch(projectId, selectedChapterId);
      result.jobs.forEach(queueImage);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo ảnh theo chương');
    }
  };
  const queueVideo = (result: VideoScheduleDto): void => {
    setAiMotion((current) => ({
      motionSource: current?.motionSource ?? 'KEN_BURNS',
      motionPlan: current?.motionPlan ?? null,
      current: result.generation,
      generations: [
        result.generation,
        ...(current?.generations ?? []).filter((item) => item.id !== result.generation.id),
      ],
    }));
    setSelectedVideoId(result.generation.id);
    setVideoJobIds((current) => [...new Set([...current, result.jobId])]);
  };
  const changeMotionSource = async (motionSource: MotionSource): Promise<void> => {
    if (!draft) return;
    try {
      await videoApi.setMotionSource(projectId, draft.id, motionSource);
      setAiMotion((current) => (current ? { ...current, motionSource } : current));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể đổi nguồn chuyển động');
    }
  };
  const saveAiMotionPlan = async (): Promise<void> => {
    if (!draft) return;
    try {
      const plan = await videoApi.saveMotionPlan(projectId, draft.id, {
        expectedRevision: aiMotion?.motionPlan?.revision,
        characterAction: motionPlanDraft.characterAction,
        environmentMotion: motionPlanDraft.environmentMotion,
        intensity: motionPlanDraft.intensity,
      });
      setAiMotion((current) => (current ? { ...current, motionPlan: plan } : current));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu kế hoạch chuyển động');
    }
  };
  const generateVideo = async (): Promise<void> => {
    if (!draft) return;
    try {
      queueVideo(await videoApi.generate(projectId, draft.id, videoInstructions.trim()));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lên lịch tạo video AI');
    }
  };
  const regenerateVideo = async (
    generationId: string,
    mode: 'SAME_SEED' | 'NEW_SEED',
    useReviewFeedback = false,
  ): Promise<void> => {
    if (!draft) return;
    try {
      queueVideo(
        await videoApi.regenerate(
          projectId,
          draft.id,
          generationId,
          mode,
          videoInstructions.trim(),
          useReviewFeedback,
        ),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể tạo lại video AI');
    }
  };
  const reviewVideo = async (
    generationId: string,
    issues: string[],
    notes: string,
  ): Promise<void> => {
    if (!draft) return;
    try {
      const saved = await videoApi.review(projectId, draft.id, generationId, issues, notes);
      setAiMotion((current) =>
        current
          ? {
              ...current,
              generations: current.generations.map((item) => (item.id === saved.id ? saved : item)),
            }
          : current,
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu đánh giá video');
    }
  };
  const acceptVideo = async (
    generationId: string,
    issues: string[],
    notes: string,
  ): Promise<void> => {
    if (!draft) return;
    try {
      await videoApi.accept(projectId, draft.id, generationId, issues, notes);
      if (selectedSceneId) setAiMotion(await videoApi.aiMotion(projectId, selectedSceneId));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể chấp nhận video AI');
    }
  };
  const selectCurrentVideo = async (generationId: string): Promise<void> => {
    if (!draft) return;
    try {
      await videoApi.setCurrent(projectId, draft.id, generationId);
      if (selectedSceneId) setAiMotion(await videoApi.aiMotion(projectId, selectedSceneId));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể chọn video hiện hành');
    }
  };
  const checkVideoReadiness = async (): Promise<void> => {
    try {
      setVideoReadiness(await videoApi.readiness(projectId));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể kiểm tra ComfyUI video');
    }
  };
  const saveVideoBackend = async (
    backend: VideoGenerationSettingsDto['backend'],
  ): Promise<void> => {
    if (!videoSettings) return;
    try {
      const {
        id,
        projectId: settingsProjectId,
        inputFingerprint,
        createdAt,
        updatedAt,
        rowVersion,
        ...settings
      } = videoSettings;
      void [id, settingsProjectId, inputFingerprint, createdAt, updatedAt];
      setVideoSettings(
        await videoApi.saveSettings(projectId, {
          ...settings,
          backend,
          workflowTemplate:
            backend === 'LTX2_19B_DISTILLED' ? 'ltx2-image-to-video-v1' : 'image-to-video-v1',
          expectedRowVersion: rowVersion,
        }),
      );
      setVideoReadiness(null);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Không thể lưu backend video');
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
  const displayedImage =
    sceneImages.find((image) => image.id === selectedImageId) ??
    sceneImages.find((image) => image.isCurrent) ??
    sceneImages[0] ??
    null;
  const imageGenerationActive = sceneImages.some((image) =>
    ['PENDING', 'RUNNING'].includes(image.status),
  );
  const displayedVideo =
    aiMotion?.generations.find((video) => video.id === selectedVideoId) ??
    aiMotion?.generations.find((video) => video.isCurrent) ??
    aiMotion?.current ??
    null;
  const videoGenerationActive =
    videoJobIds.length > 0 ||
    (aiMotion?.generations ?? []).some((video) => ['PENDING', 'RUNNING'].includes(video.status));

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
          <button className="secondary" onClick={() => setShowImageSettings((current) => !current)}>
            {showImageSettings ? 'Ẩn cài đặt tạo ảnh' : 'Cài đặt tạo ảnh'}
          </button>
          <button
            className="secondary"
            disabled={!selectedChapterId || sceneJobIds.length > 0}
            onClick={() => void generateChapterImages()}
          >
            Tạo ảnh còn thiếu trong chương
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
      {showImageSettings && imageSettings && (
        <form className="scene-style panel" onSubmit={(event) => void saveImageSettings(event)}>
          <div className="section-head">
            <div>
              <h4>ComfyUI và mặc định tạo ảnh</h4>
              <p className="muted">
                Workflow được kiểm soát bởi ứng dụng. Chỉ cấu hình endpoint, model và tham số.
              </p>
            </div>
            <span className="status-chip">Phiên bản {imageSettings.rowVersion}</span>
          </div>
          <div className="scene-form-grid">
            {(
              [
                ['baseUrl', 'URL ComfyUI'],
                ['diffusionModel', 'Diffusion model'],
                ['textEncoder', 'Text encoder'],
                ['vaeName', 'VAE'],
                ['sampler', 'Sampler'],
              ] as const
            ).map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  required
                  value={imageSettings[key]}
                  onChange={(event) =>
                    setImageSettings((current) =>
                      current ? { ...current, [key]: event.target.value } : current,
                    )
                  }
                />
              </label>
            ))}
            {(
              [
                ['width', 'Chiều rộng', 16],
                ['height', 'Chiều cao', 16],
                ['steps', 'Số bước', 1],
                ['guidance', 'Guidance', 0],
                ['connectionTimeoutMs', 'Timeout kết nối (ms)', 500],
                ['generationTimeoutMs', 'Timeout tạo ảnh (ms)', 5000],
              ] as const
            ).map(([key, label, min]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  min={min}
                  value={imageSettings[key]}
                  onChange={(event) =>
                    setImageSettings((current) =>
                      current ? { ...current, [key]: Number(event.target.value) } : current,
                    )
                  }
                />
              </label>
            ))}
            <label className="field">
              <span>Seed mặc định</span>
              <select
                value={imageSettings.seedMode}
                onChange={(event) =>
                  setImageSettings((current) =>
                    current
                      ? {
                          ...current,
                          seedMode: event.target.value as ImageGenerationSettingsDto['seedMode'],
                          fixedSeed:
                            event.target.value === 'FIXED' ? (current.fixedSeed ?? 0) : null,
                        }
                      : current,
                  )
                }
              >
                <option value="RANDOM">Ngẫu nhiên</option>
                <option value="FIXED">Cố định</option>
              </select>
            </label>
            {imageSettings.seedMode === 'FIXED' && (
              <label className="field">
                <span>Fixed seed</span>
                <input
                  type="number"
                  min="0"
                  value={imageSettings.fixedSeed ?? 0}
                  onChange={(event) =>
                    setImageSettings((current) =>
                      current ? { ...current, fixedSeed: Number(event.target.value) } : current,
                    )
                  }
                />
              </label>
            )}
          </div>
          {imageReadiness && (
            <div
              className={`scene-job-status readiness-${imageReadiness.status.toLowerCase()}`}
              role="status"
            >
              {imageReadiness.status}: {imageReadiness.message}
            </div>
          )}
          <div className="actions">
            <button type="submit">Lưu cài đặt</button>
            <button type="button" className="secondary" onClick={() => void checkImageReadiness()}>
              Kiểm tra kết nối
            </button>
          </div>
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
              <section
                className="visual-package-summary field-wide"
                aria-labelledby="shot-plan-heading"
              >
                <div className="section-head">
                  <div>
                    <span className="field-label" id="shot-plan-heading">
                      Kế hoạch shot
                    </span>
                    <p className="muted">
                      {shotPlan
                        ? `${shotPlan.candidate.shots.length} shot - bản ${shotPlan.revision} - ${shotPlan.reviewStatus}`
                        : 'Chưa có kế hoạch shot cho cảnh này.'}
                    </p>
                  </div>
                  <div className="chip-row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={sceneJobIds.length > 0}
                      onClick={() => void generateShotPlan()}
                    >
                      {shotPlan ? 'Lập lại shot' : 'Lập shot'}
                    </button>
                    {shotPlan && (
                      <>
                        <button type="button" onClick={() => void reviewShotPlan('APPROVED')}>
                          Duyệt
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void reviewShotPlan('REJECTED')}
                        >
                          Từ chối
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {shotPlan && (
                  <ol className="compact-list">
                    {shotPlan.candidate.shots.slice(0, 24).map((shot) => (
                      <li key={shot.id}>
                        <strong>Shot {shot.ordinal}</strong>
                        <span>
                          {shot.primaryBeat} - {shot.staticIntent.framing} -{' '}
                          {shot.plannedDurationMs} ms
                        </span>
                      </li>
                    ))}
                    {shotPlan.candidate.shots.length > 24 && (
                      <li>Còn {shotPlan.candidate.shots.length - 24} shot trong trang chi tiết.</li>
                    )}
                  </ol>
                )}
              </section>
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
              <section className="scene-image-panel field-wide">
                <div className="section-head">
                  <div>
                    <span className="field-label">Ảnh cảnh</span>
                    <p className="muted">
                      Tạo bằng Visual Prompt Package hiện hành hoặc thay bằng ảnh thủ công.
                    </p>
                  </div>
                  <div className="chip-row">
                    {displayedImage && (
                      <>
                        <span
                          className={`status-chip status-${displayedImage.status.toLowerCase()}`}
                        >
                          {displayedImage.status}
                        </span>
                        <span
                          className={`status-chip status-${displayedImage.freshness.toLowerCase()}`}
                        >
                          {displayedImage.freshness}
                        </span>
                        <span className="status-chip">
                          {displayedImage.source === 'MANUAL' ? 'Thủ công' : 'ComfyUI'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {displayedImage?.assetUrl ? (
                  <img
                    className="scene-image-preview"
                    src={`${API_BASE}${displayedImage.assetUrl}`}
                    alt={`Ảnh cho cảnh ${draft.sceneNumber}: ${draft.title}`}
                  />
                ) : (
                  <div className="scene-image-empty">
                    {imageGenerationActive ? 'Đang tạo ảnh...' : 'Cảnh này chưa có ảnh.'}
                  </div>
                )}
                {displayedImage && (
                  <div className="scene-image-meta">
                    <span>
                      Seed {displayedImage.actualSeed ?? displayedImage.requestedSeed ?? 'n/a'}
                    </span>
                    <span>
                      {displayedImage.actualWidth ?? displayedImage.requestedWidth ?? '?'} ×{' '}
                      {displayedImage.actualHeight ?? displayedImage.requestedHeight ?? '?'}
                    </span>
                    <span>Lần thử {displayedImage.attempt}</span>
                    <span>
                      Duyệt:{' '}
                      {displayedImage.reviewStatus === 'ACCEPTED'
                        ? 'Đã chấp nhận'
                        : displayedImage.reviewStatus === 'REJECTED'
                          ? 'Đã từ chối'
                          : 'Chưa duyệt'}
                    </span>
                  </div>
                )}
                {displayedImage?.error && (
                  <div className="scene-job-error" role="alert">
                    {displayedImage.errorCode}: {displayedImage.error}
                  </div>
                )}
                <label className="field field-wide">
                  <span>Chỉ dẫn bổ sung cho lần tạo ảnh</span>
                  <textarea
                    maxLength={2000}
                    value={imageInstructions}
                    onChange={(event) => setImageInstructions(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Chế độ tạo ảnh</span>
                  <select
                    value={imageModeOverride}
                    onChange={(event) =>
                      setImageModeOverride(
                        event.target.value as '' | 'TEXT_ONLY' | 'REFERENCE_CONDITIONED',
                      )
                    }
                  >
                    <option value="">
                      Mặc định dự án ({imageSettings?.conditioningMode ?? 'TEXT_ONLY'})
                    </option>
                    <option value="TEXT_ONLY">Chỉ văn bản (TEXT_ONLY)</option>
                    <option value="REFERENCE_CONDITIONED">
                      Theo ảnh tham chiếu (REFERENCE_CONDITIONED)
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>Số ảnh tạo (GPU)</span>
                  <select
                    value={candidateCount}
                    onChange={(event) => setCandidateCount(Number(event.target.value))}
                  >
                    <option value="1">1 ảnh</option>
                    <option value="2">2 ảnh</option>
                    <option value="4">4 ảnh</option>
                  </select>
                  <small className="muted">Mỗi ảnh là một job GPU riêng, chạy tuần tự.</small>
                </label>
                <p className="muted" aria-disabled="true">
                  Điều khiển ảnh nâng cao: không khả dụng - không có ControlNet tương thích FLUX.2
                  Klein trên máy.
                </p>
                <div className="actions">
                  {!scenePackage && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={sceneJobIds.length > 0}
                      onClick={() => void rebuildVisualPackage()}
                    >
                      Tạo Visual Prompt Package
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!scenePackage || imageGenerationActive}
                    onClick={() => void generateSceneImage()}
                  >
                    Tạo ảnh
                  </button>
                  {displayedImage?.status === 'COMPLETED' &&
                    displayedImage.source === 'GENERATED' && (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={imageGenerationActive}
                          onClick={() => void regenerateImage(displayedImage.id, 'SAME_SEED')}
                        >
                          Tạo lại cùng seed
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={imageGenerationActive}
                          onClick={() => void regenerateImage(displayedImage.id, 'NEW_SEED')}
                        >
                          Tạo lại seed mới
                        </button>
                      </>
                    )}
                  <label className="button secondary upload-button">
                    Thay ảnh thủ công
                    <input
                      hidden
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void uploadSceneImage(event)}
                    />
                  </label>
                  {displayedImage?.status === 'COMPLETED' && (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void acceptImage(displayedImage.id)}
                      >
                        Chấp nhận
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void reviewImage(displayedImage.id, 'REJECTED')}
                      >
                        Từ chối
                      </button>
                      {!displayedImage.isCurrent && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void selectCurrentImage(displayedImage.id)}
                        >
                          Chọn làm ảnh hiện hành
                        </button>
                      )}
                    </>
                  )}
                </div>
                {displayedImage && conditioningSummary(displayedImage) && (
                  <p className="muted conditioning-info">
                    Conditioning: {conditioningSummary(displayedImage)}
                  </p>
                )}
                {displayedImage?.status === 'COMPLETED' && draft.characters.length > 0 && (
                  <div className="promote-reference actions">
                    <select
                      value={promoteCharacterId}
                      onChange={(event) => setPromoteCharacterId(event.target.value)}
                      aria-label="Nhân vật dùng ảnh làm tham chiếu"
                    >
                      <option value="">Chọn nhân vật...</option>
                      {draft.characters.map((character) => (
                        <option
                          key={character.characterId ?? character.displayName}
                          value={character.characterId ?? ''}
                          disabled={character.resolutionStatus !== 'RESOLVED'}
                        >
                          {character.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!promoteCharacterId}
                      onClick={() => void promoteDisplayedImage()}
                    >
                      Dùng làm tham chiếu nhân vật
                    </button>
                  </div>
                )}
                {sceneImages.length > 0 && (
                  <div className="candidate-grid" aria-label="Lưới ảnh cảnh">
                    {sceneImages.map((image) => (
                      <article
                        key={image.id}
                        className={`candidate-card${image.id === displayedImage?.id ? ' active' : ''}`}
                      >
                        {image.assetUrl ? (
                          <button
                            type="button"
                            className="candidate-thumb"
                            onClick={() => setSelectedImageId(image.id)}
                            aria-label={`Xem ảnh v${image.revision}`}
                          >
                            <img
                              src={`${API_BASE}${image.assetUrl}`}
                              alt={`Ảnh v${image.revision} cho cảnh ${draft.sceneNumber}: ${draft.title}`}
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <div className="candidate-empty">{image.status}</div>
                        )}
                        <div className="candidate-meta">
                          <span>v{image.revision}</span>
                          <span>Seed {image.actualSeed ?? image.requestedSeed ?? 'n/a'}</span>
                          <span>{image.reviewStatus}</span>
                          {image.isCurrent && <strong>HIỆN HÀNH</strong>}
                          {image.freshness === 'STALE' && <em>Stale</em>}
                        </div>
                        {image.status === 'COMPLETED' && (
                          <div className="candidate-actions">
                            <button type="button" onClick={() => void acceptImage(image.id)}>
                              Chấp nhận
                            </button>
                            <button
                              type="button"
                              onClick={() => void reviewImage(image.id, 'REJECTED')}
                            >
                              Từ chối
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {displayedImage?.status === 'COMPLETED' && (
                  <div className="quality-review">
                    <span className="field-label">
                      Đánh giá chất lượng ảnh v{displayedImage.revision}
                    </span>
                    <div className="score-grid">
                      {scoreCategories.map((category) => (
                        <label key={category}>
                          <span>{category}</span>
                          <select
                            value={
                              reviewDraft.generationId === displayedImage.id
                                ? (reviewDraft.scores[category] ?? '')
                                : ''
                            }
                            onChange={(event) =>
                              setReviewDraft({
                                generationId: displayedImage.id,
                                scores: {
                                  ...reviewDraft.scores,
                                  [category]: Number(event.target.value),
                                },
                                issues: reviewDraft.issues,
                                notes: reviewDraft.notes,
                              })
                            }
                          >
                            <option value="">-</option>
                            {[1, 2, 3, 4, 5].map((score) => (
                              <option key={score} value={score}>
                                {score}/5
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <fieldset>
                      <legend>Vấn đề</legend>
                      {issueTags.map((tag) => (
                        <label key={tag} className="issue-checkbox">
                          <input
                            type="checkbox"
                            checked={
                              reviewDraft.generationId === displayedImage.id &&
                              reviewDraft.issues.includes(tag)
                            }
                            onChange={(event) =>
                              setReviewDraft({
                                generationId: displayedImage.id,
                                scores: reviewDraft.scores,
                                issues: event.target.checked
                                  ? [...reviewDraft.issues, tag]
                                  : reviewDraft.issues.filter((value) => value !== tag),
                                notes: reviewDraft.notes,
                              })
                            }
                          />
                          {tag}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      <span>Ghi chú</span>
                      <textarea
                        maxLength={1000}
                        value={
                          reviewDraft.generationId === displayedImage.id ? reviewDraft.notes : ''
                        }
                        onChange={(event) =>
                          setReviewDraft({
                            generationId: displayedImage.id,
                            scores: reviewDraft.scores,
                            issues: reviewDraft.issues,
                            notes: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          void reviewImage(
                            displayedImage.id,
                            'REJECTED',
                            reviewDraft.scores,
                            reviewDraft.issues,
                            reviewDraft.notes,
                          );
                        }}
                      >
                        Lưu đánh giá (Từ chối)
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void regenerateImage(displayedImage.id, 'NEW_SEED', true)}
                      >
                        Tạo lại theo phản hồi
                      </button>
                    </div>
                  </div>
                )}
                {sceneImages.filter((image) => image.status === 'COMPLETED' && image.assetUrl)
                  .length >= 2 && (
                  <div className="scene-image-compare">
                    <span className="field-label">So sánh hai bản tạo</span>
                    <div className="compare-pickers">
                      <select
                        value={compareAId ?? ''}
                        onChange={(event) => setCompareAId(event.target.value || null)}
                        aria-label="Ảnh bên trái"
                      >
                        <option value="">Ảnh A...</option>
                        {sceneImages
                          .filter((image) => image.status === 'COMPLETED' && image.assetUrl)
                          .map((image) => (
                            <option key={image.id} value={image.id}>
                              v{image.revision} ·{' '}
                              {conditioningSummary(image).split(' · ')[0] || 'Không conditioning'}
                            </option>
                          ))}
                      </select>
                      <select
                        value={compareBId ?? ''}
                        onChange={(event) => setCompareBId(event.target.value || null)}
                        aria-label="Ảnh bên phải"
                      >
                        <option value="">Ảnh B...</option>
                        {sceneImages
                          .filter((image) => image.status === 'COMPLETED' && image.assetUrl)
                          .map((image) => (
                            <option key={image.id} value={image.id}>
                              v{image.revision} ·{' '}
                              {conditioningSummary(image).split(' · ')[0] || 'Không conditioning'}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="compare-grid">
                      {[compareAId, compareBId].map((id, index) => {
                        const image = sceneImages.find((item) => item.id === id) ?? null;
                        return (
                          <figure key={index} className="compare-item">
                            {image?.assetUrl ? (
                              <img
                                src={`${API_BASE}${image.assetUrl}`}
                                alt={`So sánh ${index === 0 ? 'A' : 'B'}`}
                              />
                            ) : (
                              <div className="scene-image-empty">Chưa chọn</div>
                            )}
                            <figcaption className="muted">
                              {image
                                ? `v${image.revision} · seed ${image.actualSeed ?? image.requestedSeed ?? 'n/a'} · ${
                                    conditioningSummary(image) || 'Thủ công'
                                  }`
                                : `Ảnh ${index === 0 ? 'A' : 'B'}`}
                            </figcaption>
                          </figure>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
              <section className="scene-image-panel field-wide">
                <div className="section-head">
                  <div>
                    <span className="field-label">Chuyển động AI</span>
                    <p className="muted">
                      Lập kế hoạch motion và tạo clip AI từ ảnh hiện hành của cảnh.
                    </p>
                  </div>
                  <div className="chip-row">
                    {displayedVideo && (
                      <>
                        <span
                          className={`status-chip status-${displayedVideo.status.toLowerCase()}`}
                        >
                          {displayedVideo.status}
                        </span>
                        <span
                          className={`status-chip status-${displayedVideo.freshness.toLowerCase()}`}
                        >
                          {displayedVideo.freshness}
                        </span>
                        <span className="status-chip">
                          Duyệt:{' '}
                          {displayedVideo.reviewStatus === 'ACCEPTED'
                            ? 'Đã chấp nhận'
                            : displayedVideo.reviewStatus === 'REJECTED'
                              ? 'Đã từ chối'
                              : 'Chưa duyệt'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="scene-form-grid">
                  <label className="field">
                    <span>Nguồn chuyển động</span>
                    <select
                      value={aiMotion?.motionSource ?? 'KEN_BURNS'}
                      onChange={(event) =>
                        void changeMotionSource(event.target.value as MotionSource)
                      }
                    >
                      <option value="KEN_BURNS">Ken Burns</option>
                      <option value="AI_VIDEO">AI Video</option>
                      <option value="HYBRID">Kết hợp</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Backend video</span>
                    <select
                      value={videoSettings?.backend ?? 'WAN22_TI2V_5B'}
                      disabled={!videoSettings}
                      onChange={(event) =>
                        void saveVideoBackend(
                          event.target.value as VideoGenerationSettingsDto['backend'],
                        )
                      }
                    >
                      <option value="WAN22_TI2V_5B">Wan 2.2 TI2V 5B</option>
                      <option value="LTX2_19B_DISTILLED">LTX-2 19B Distilled</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Cường độ</span>
                    <select
                      value={motionPlanDraft.intensity}
                      onChange={(event) =>
                        setMotionPlanDraft({
                          ...motionPlanDraft,
                          intensity: event.target.value as AiMotionIntensity,
                        })
                      }
                    >
                      <option value="SUBTLE">Nhẹ</option>
                      <option value="MEDIUM">Vừa</option>
                      <option value="STRONG">Mạnh</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Hành động nhân vật</span>
                    <input
                      maxLength={500}
                      value={motionPlanDraft.characterAction}
                      onChange={(event) =>
                        setMotionPlanDraft({
                          ...motionPlanDraft,
                          characterAction: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Chuyển động môi trường</span>
                    <input
                      maxLength={500}
                      value={motionPlanDraft.environmentMotion}
                      onChange={(event) =>
                        setMotionPlanDraft({
                          ...motionPlanDraft,
                          environmentMotion: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!draft}
                    onClick={() => void saveAiMotionPlan()}
                  >
                    Lưu kế hoạch
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void checkVideoReadiness()}
                  >
                    Kiểm tra AI video
                  </button>
                </div>
                {videoReadiness && (
                  <div
                    className={`scene-job-status readiness-${videoReadiness.status.toLowerCase()}`}
                    role="status"
                  >
                    {videoReadiness.status}: {videoReadiness.message}
                  </div>
                )}
                <label className="field field-wide">
                  <span>Chỉ dẫn bổ sung cho video</span>
                  <textarea
                    maxLength={2000}
                    value={videoInstructions}
                    onChange={(event) => setVideoInstructions(event.target.value)}
                  />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    disabled={!displayedImage || videoGenerationActive}
                    onClick={() => void generateVideo()}
                  >
                    Tạo video AI
                  </button>
                  {displayedVideo?.status === 'FAILED' && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={videoGenerationActive}
                      onClick={() => void generateVideo()}
                    >
                      Thử lại
                    </button>
                  )}
                  {displayedVideo?.status === 'COMPLETED' && (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        disabled={videoGenerationActive}
                        onClick={() => void regenerateVideo(displayedVideo.id, 'SAME_SEED')}
                      >
                        Tạo lại cùng seed
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={videoGenerationActive}
                        onClick={() => void regenerateVideo(displayedVideo.id, 'NEW_SEED')}
                      >
                        Tạo lại seed mới
                      </button>
                    </>
                  )}
                </div>
                {displayedVideo?.error && (
                  <div className="scene-job-error" role="alert">
                    {displayedVideo.errorCode}: {displayedVideo.error}
                  </div>
                )}
                {displayedVideo?.assetUrl && (
                  <video
                    className="video"
                    controls
                    preload="metadata"
                    src={`${API_BASE}${displayedVideo.assetUrl}`}
                  />
                )}
                {displayedVideo && (
                  <div className="scene-image-meta">
                    <span>
                      Seed {displayedVideo.actualSeed ?? displayedVideo.requestedSeed ?? 'n/a'}
                    </span>
                    <span>
                      {displayedVideo.actualWidth ?? displayedVideo.requestedWidth ?? '?'} ×{' '}
                      {displayedVideo.actualHeight ?? displayedVideo.requestedHeight ?? '?'}
                    </span>
                    {displayedVideo.clipDurationMs != null && (
                      <span>{(displayedVideo.clipDurationMs / 1_000).toFixed(2)}s</span>
                    )}
                    <span>Lần thử {displayedVideo.attempt}</span>
                  </div>
                )}
                {(aiMotion?.generations.length ?? 0) > 0 && (
                  <div className="candidate-grid" aria-label="Lưới video AI">
                    {aiMotion?.generations.map((video) => (
                      <article
                        key={video.id}
                        className={`candidate-card${video.id === displayedVideo?.id ? ' active' : ''}`}
                      >
                        {video.assetUrl ? (
                          <video
                            controls
                            preload="metadata"
                            src={`${API_BASE}${video.assetUrl}`}
                            onClick={() => setSelectedVideoId(video.id)}
                          />
                        ) : (
                          <div className="candidate-empty">{video.status}</div>
                        )}
                        <div className="candidate-meta">
                          <span>v{video.revision}</span>
                          <span>Seed {video.actualSeed ?? video.requestedSeed ?? 'n/a'}</span>
                          <span>{video.reviewStatus}</span>
                          {video.isCurrent && <strong>HIỆN HÀNH</strong>}
                          {video.freshness === 'STALE' && <em>Stale</em>}
                        </div>
                        <div className="candidate-actions">
                          <button type="button" onClick={() => setSelectedVideoId(video.id)}>
                            Xem
                          </button>
                          {video.status === 'COMPLETED' && (
                            <button
                              type="button"
                              onClick={() => void acceptVideo(video.id, [], '')}
                            >
                              Chấp nhận
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {displayedVideo?.status === 'COMPLETED' && (
                  <div className="quality-review">
                    <span className="field-label">
                      Đánh giá chất lượng video v{displayedVideo.revision}
                    </span>
                    <fieldset>
                      <legend>Vấn đề</legend>
                      {videoIssueTags.map((tag) => (
                        <label key={tag} className="issue-checkbox">
                          <input
                            type="checkbox"
                            checked={
                              videoReviewDraft.generationId === displayedVideo.id &&
                              videoReviewDraft.issues.includes(tag)
                            }
                            onChange={(event) =>
                              setVideoReviewDraft({
                                generationId: displayedVideo.id,
                                issues: event.target.checked
                                  ? [...videoReviewDraft.issues, tag]
                                  : videoReviewDraft.issues.filter((value) => value !== tag),
                                notes: videoReviewDraft.notes,
                              })
                            }
                          />
                          {tag}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      <span>Ghi chú</span>
                      <textarea
                        maxLength={1000}
                        value={
                          videoReviewDraft.generationId === displayedVideo.id
                            ? videoReviewDraft.notes
                            : ''
                        }
                        onChange={(event) =>
                          setVideoReviewDraft({
                            generationId: displayedVideo.id,
                            issues: videoReviewDraft.issues,
                            notes: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void reviewVideo(
                            displayedVideo.id,
                            videoReviewDraft.generationId === displayedVideo.id
                              ? videoReviewDraft.issues
                              : [],
                            videoReviewDraft.generationId === displayedVideo.id
                              ? videoReviewDraft.notes
                              : '',
                          )
                        }
                      >
                        Lưu đánh giá (Từ chối)
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void acceptVideo(
                            displayedVideo.id,
                            videoReviewDraft.generationId === displayedVideo.id
                              ? videoReviewDraft.issues
                              : [],
                            videoReviewDraft.generationId === displayedVideo.id
                              ? videoReviewDraft.notes
                              : '',
                          )
                        }
                      >
                        Chấp nhận video
                      </button>
                      {!displayedVideo.isCurrent && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void selectCurrentVideo(displayedVideo.id)}
                        >
                          Chọn làm video hiện hành
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
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
