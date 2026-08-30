# Workflow

SQLite is the source of truth. A scheduled execution materializes named steps and dependencies:

```text
CLEAN_TEXT -> TTS_SEGMENT 0 -> TTS_SEGMENT 1 -> ... -> MERGE_AUDIO
                                      `-> SUBTITLE
MERGE_AUDIO + current background + current subtitle + optional music -> RENDER
```

Each step has a persisted status, fingerprint, progress, attempts, lease owner, lease expiry, and bounded error. Jobs reference steps and expose status through `GET /api/jobs/:id`.

The worker claims one eligible step transactionally, creates an attempt, leases it, updates progress, and conditionally completes or fails it. Expired leases are recovered on startup. Failed work retries up to the step limit; the retry endpoint resets the failed step without regenerating completed TTS assets. Completed TTS segments with the same text hash and an existing audio asset are reused.

Chapter edits create a new revision and invalidate dependent current outputs. Asset registration first clears the prior current pointer for a role, then commits a validated READY asset. Historical rows and files remain available for diagnosis.

Manual flow:

1. Create a project.
2. Add and save chapter text.
3. Upload a background image or video.
4. Generate narration.
5. Generate subtitles.
6. Render MP4.
7. Poll the job until `COMPLETED`; retry a failed job from its job endpoint.
