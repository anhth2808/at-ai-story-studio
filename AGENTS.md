# AGENTS.md

## User rules

- Use "-" instead of "—"
This is already set in the repo's git config, so just commit normally - do not
pass `-c user.name=` / `-c user.email=` overrides.
- Sometime i will write vietnamese. You can answer by vietnamese but do not write any code, docs by vietnamese (except site content)
- Site content (UI copy, Sanity content, SEO metadata) is Vietnamese. Code, comments, and planning artifacts are English.
- Imporant: only use Vietnamese or English. No chinese here.

## Project Overview

This repository contains **AI Story Studio**.

The primary goal is to build a local-first application that can progressively evolve from:

V1:
Story
→ TTS
→ Subtitle
→ Background Visual
→ Render
→ YouTube-ready MP4

toward:

V2:
Story
→ Scene Images
→ TTS
→ Animated Visuals
→ MP4

V3:
Story
→ Character Memory
→ Scene Planning
→ Consistent Images
→ Image-to-Video

V4:
Novel
→ Global Story Understanding
→ World Bible
→ Character Bible
→ Scene Graph
→ Shot Planning
→ AI Video

V5:
Generation
→ Quality Evaluation
→ Automatic Regeneration
→ Final Movie

The current priority is always the smallest working vertical slice.

---

# Core Principles

## 1. Working Software First

Prefer:

- a complete working vertical slice
- simple architecture
- clear module boundaries
- reliable error handling
- resumable workflows

over:

- premature abstraction
- complex plugin systems
- distributed architecture
- unnecessary infrastructure
- implementing future features too early

Do not expand scope unless explicitly requested.

---

## 2. Keep V1 Small

For the initial implementation, focus only on:

Text
→ TTS
→ Subtitle
→ Background Image/Video
→ FFmpeg
→ MP4

Do NOT implement advanced AI features unless explicitly requested.

This includes:

- story generation
- story adaptation
- character memory
- world bible
- scene graph
- shot planning
- WhisperX
- F5-TTS
- GPT-SoVITS
- ComfyUI
- AI image generation
- AI video generation
- image-to-video
- YouTube publishing
- generic workflow designers
- generic plugin systems

---

# Architecture

Prefer a modular monolith.

Recommended stack:

Backend:
- ASP.NET Core
- current .NET LTS

Persistence:
- SQLite
- Entity Framework Core

Worker:
- .NET BackgroundService

Frontend:
- React
- TypeScript

Media:
- FFmpeg
- ffprobe

Storage:
- local filesystem

AI/ML tools that require Python should run as external processes or services.

Do NOT move the main application orchestration/business logic into Python without a strong reason.

---

# Solution Structure

Prefer a structure similar to:

```text
src/

  AiStoryStudio.Api/

  AiStoryStudio.Application/

  AiStoryStudio.Domain/

  AiStoryStudio.Infrastructure/

  AiStoryStudio.Worker/

  AiStoryStudio.Web/