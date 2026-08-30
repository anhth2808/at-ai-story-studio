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

Story generation uses the same durable workflow tables:

```text
GENERATE_STORY_BLUEPRINT -> GENERATE_CHAPTER_PLANS -> GENERATE_CHAPTER
                                                    `-> GENERATE_CHAPTER_SUMMARY
```

Blueprint, plan, chapter, and summary jobs are independently retryable and report progress from the isolated OMP host. A completed Story step does not enqueue media. Generating a chapter promotes a validated envelope into the ordinary chapter revision only when the plan-item fingerprint is still current; a newer manual chapter revision produces `MANUAL_EDIT_CONFLICT` instead of being overwritten. Changing settings, blueprint, a plan item, or a chapter invalidates only dependent Story records and media descendants.

Manual flow:

1. Create a project.
2. Add and save chapter text.
3. Upload a background image or video.
4. Generate narration.
5. Generate subtitles.
6. Render MP4.
7. Poll the job until `COMPLETED`; retry a failed job from its job endpoint.
