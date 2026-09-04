# Animated Story Timeline UI Specification

## Purpose

Expose the animated-story timeline as a reviewable, functional workspace without turning the application into a full video editor.

## Requirements

### Requirement: Timeline navigation and chapter scenes
The web application SHALL expose a Timeline tab alongside Story, Scenes, Visual Bible, Images, Audio, and Render surfaces. The Timeline view SHALL allow a user to choose a Chapter and inspect its current ordered SceneTimelineItems without loading binary media into API JSON.

#### Scenario: Open a Chapter timeline
- **WHEN** a user opens the Timeline tab for Chapter 3
- **THEN** the UI SHALL show each current Scene with thumbnail or missing-image state, start time, duration, motion, transition, and render status in narrative order

#### Scenario: Browse a large Story
- **WHEN** a project contains many Chapters
- **THEN** Timeline reads SHALL be paginated or chapter-scoped and SHALL not request the complete Story media payload in one response

### Requirement: Timeline review actions
For each Scene item the UI SHALL provide functional actions for previewing the Scene or clip when available, editing MotionPlan values through bounded controls, choosing a different valid current image, and viewing status/error/prerequisite details. Status SHALL be conveyed with text and accessible labels, not color alone.

#### Scenario: Scene has no accepted image
- **WHEN** a Scene has generated candidates but no accepted/current image
- **THEN** the Timeline SHALL show a clear missing-image status and SHALL not present a rejected candidate as the render input

#### Scenario: Preview motion
- **WHEN** a valid MotionPlan exists
- **THEN** the user SHALL be able to request a lightweight preview or inspect the plan without requiring a complete multi-hour Project render

### Requirement: Manual timing controls
The UI SHALL support AUTO/MANUAL timing display and bounded manual timing edits where practical. It SHALL show the Chapter narration duration, preserve total duration, warn or reject overlap/gaps/out-of-bounds values, and explain when a manual timing lock prevents automatic replacement.

#### Scenario: Save valid manual timing
- **WHEN** a user adjusts Scene boundaries without overlap and with complete coverage
- **THEN** the UI SHALL save the manual timing revision and mark it locked against automatic rebuilds until explicitly unlocked or replaced

#### Scenario: Reject broken timing
- **WHEN** a user creates an overlap or uncovered interval
- **THEN** the UI SHALL identify the affected interval and SHALL keep the last valid timing

### Requirement: Render scope controls
The UI SHALL support explicit render actions for one Scene, one Chapter, an inclusive Chapter range, selected Chapters, and the full Story. Before a large render it SHALL expose the RenderPlan, reusable/required counts, blocked prerequisites, and an auto-build choice.

#### Scenario: Preview before full render
- **WHEN** a user requests a full-story preview plan
- **THEN** the UI SHALL show hierarchical Scene Clip/Chapter/final assembly counts and SHALL not start rendering until the user chooses an execution action

#### Scenario: Render a range
- **WHEN** a user selects Chapters 5-10 and starts rendering
- **THEN** only that range SHALL be scheduled and the resulting Project Video metadata SHALL identify the selected scope

### Requirement: Hierarchical progress and recovery
The UI SHALL show Scene Clip progress, Chapter Video progress, final assembly progress, failures, retry actions, and restart-safe status using persisted jobs. It SHALL distinguish reusable completed work from work that must run again.

#### Scenario: Retry a failed Scene Clip
- **WHEN** a Scene Clip job fails
- **THEN** the UI SHALL expose retry for that unit and SHALL show dependent Chapter/Project work waiting rather than claiming a complete Story render

### Requirement: Responsive accessible controls
Timeline controls SHALL use the existing web visual language and native accessible elements, provide keyboard operation, descriptive image alt text, visible labels, loading/error/empty states, and remain usable at desktop and narrow mobile widths without horizontal scrolling.

#### Scenario: View on a narrow viewport
- **WHEN** the Timeline is opened at approximately 375 px width
- **THEN** Scene metadata and actions SHALL remain readable and operable without relying on hover or color-only status

### Requirement: Clip source and AI status in timeline
The timeline per-Scene card SHALL display the SceneClip source mode (KEN_BURNS/AI_VIDEO/HYBRID), the AI motion generation/review status when applicable, and a playable normalized SceneClip preview. AI controls SHALL integrate into the existing timeline/Scene surfaces; no separate AI video timeline view SHALL be created.

#### Scenario: Scene clip preview in timeline
- **WHEN** a Scene has a current normalized SceneClip of AI origin
- **THEN** the timeline card SHALL offer playback of that clip and show its source badge
