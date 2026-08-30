# Subtitle Pipeline

## V1 recommendation

Use **Approach A: known TTS text segments plus measured audio timings** by default. Each narration segment already has authoritative text, and segment/chunk audio duration is measured after synthesis. This is local/free, fast, has no transcription wording errors, and aligns naturally with independently retryable TTS units.

Use **Approach B: WhisperX ASR + forced alignment** as an optional quality mode when provider timings are absent or word-level timing matters. It adds GPU/CPU time, model/language availability, and possible ASR text mismatch; it should not block first-video delivery.

## Timing sources in priority order

1. Provider word/sentence boundaries, normalized to segment timeline.
2. One-audio-unit-per-caption-segment measured duration.
3. Multiple segments in one provider chunk: allocate using provider boundaries when available; otherwise synthesize segment-sized units in V1 rather than invent precise timings.
4. Optional WhisperX alignment of known text/audio for word-level upgrade.
5. Raw ASR transcription only when text is unknown; not normal generated-story flow.

This avoids a false promise that character-count interpolation produces accurate speech timing.

## Cue model

`SubtitleDocument`: format version, language, source chapter/audio/segment manifest IDs, timing method/provider, total duration, style defaults.

`SubtitleCue`:

- stable cue ID and ordinal;
- `Start`, `End`, text;
- source segment IDs and chapter ID;
- optional `SpeakerId`/style role;
- optional words: text, start, end, confidence;
- optional line-break/layout hints.

Timing and presentation are separate. SRT serialization ignores styling; a future ASS/WebVTT renderer consumes style roles and words.

## Pipeline

1. Read current segment manifest and exact audio assets/durations.
2. Offset segment-local timing into chapter time.
3. Split overly long display text by punctuation and configured max characters/lines only where timing boundaries permit.
4. Enforce monotonic non-overlapping cues, minimum readable duration, maximum gap policy, and final duration bound.
5. Serialize UTF-8 SRT with CRLF/LF handled consistently and `HH:MM:SS,mmm` timestamps.
6. Validate by parsing the emitted SRT and checking duration/reference hashes.
7. Store structured JSON cue asset plus SRT asset. JSON is the future-proof source; SRT is V1 output.

For a full video, timeline compilation offsets chapter cues by accumulated narration positions/gaps and writes a final SRT/ASS render asset.

## Styling

V1 configuration: font family/file, size, text color, outline color/width, shadow, bottom margin, alignment, max lines, optional background box. Render resolves an available font and records its file hash. UI preview warns when the selected font lacks project-language glyphs.

Future support:

- word-level timing lives in `SubtitleCue.Words`;
- karaoke compiles words to ASS karaoke tags;
- speaker/character roles select styles;
- WebVTT/export can share the structured cue source;
- editable cue revisions invalidate only final subtitle/render descendants, not audio.

## Invalidation

Subtitle fingerprint includes current segment/timing assets, chapter audio hash, timing method/provider/model, cue-builder version, language/display rules, and—only for burned/styled output—style configuration. Editing subtitle wording invalidates the final combined subtitle and render, not TTS.

## Decision: SRT export plus structured cue source

- **Alternatives:** store SRT only; WhisperX always; burn text directly during render with no subtitle asset.
- **Why:** SRT meets V1 interoperability while structured cues preserve word/style evolution.
- **Trade-offs:** two representations require validation; default timing is segment-level rather than karaoke-perfect.
- **Future impact:** alignment and ASS/karaoke become new timing/render steps, not a schema rewrite.
