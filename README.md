# ai-audio-reference

Reference workspace for researching open-source AI video-generation workflows and shaping the architecture of a future AI Video Studio.

## Purpose

This repository collects upstream projects that cover complementary parts of an AI video pipeline: scripting and story generation, media selection, speech synthesis and voice cloning, transcription and alignment, subtitle handling, translation, and final video composition. The catalog in [`references/README.md`](references/README.md) maps each local clone to its upstream project and primary workflow area.

The workspace is for study and comparison. The repositories under `references/` are read-only inputs and are excluded from the parent repository by `.gitignore`; do not modify their source code or commit their contents. Use `docs/` for notes, workflow observations, and later architecture analysis.

## Scope of this step

This step only prepares the reference workspace. It does **not** implement the AI Video Studio or any application runtime. Application design and implementation will follow after the open-source workflows have been analyzed.

## Layout

```text
/at-ai-story-studio
├── references/   # local upstream clones; ignored by the parent repository
├── docs/         # future research notes and architecture analysis
└── README.md
```

