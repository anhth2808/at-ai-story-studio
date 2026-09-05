export type TtsQualityMetrics = {
  durationMs: number;
  activityRatio: number;
  textLength: number;
  provider: 'EDGE_TTS';
};

export function ttsQualityIssues(metrics: TtsQualityMetrics): string[] {
  const issues: string[] = [];
  if (metrics.durationMs < 250) issues.push('AUDIO_NEAR_EMPTY');
  if (metrics.durationMs > 180_000) issues.push('DURATION_EXTREME');
  const charactersPerSecond = metrics.textLength / (metrics.durationMs / 1_000);
  if (metrics.textLength >= 4 && (charactersPerSecond < 1 || charactersPerSecond > 35))
    issues.push('TEXT_DURATION_RATIO');
  if (metrics.activityRatio < 0.35) issues.push('EXCESSIVE_SILENCE');
  return issues;
}
