## Why

Create a clean, reproducible reference workspace before designing the AI Video Studio. The workspace will preserve upstream Git histories while keeping reference source trees out of the future application repository, enabling focused workflow and architecture research without implementing product code yet.

## What Changes

- Initialize the repository as `ai-audio-reference`.
- Add a root `.gitignore` entry for `/references` so upstream clones remain read-only local research material and are not committed.
- Clone the ten requested open-source projects into `references/` using their expected directory names.
- Add `references/README.md` with each project’s GitHub URL and primary purpose.
- Add a root `README.md` describing the workspace’s role in studying open-source AI video-generation workflows and informing a future AI Video Studio.
- Keep `docs/` available for later research notes; do not implement the application.

## Capabilities

### New Capabilities

- `reference-workspace`: Provides a documented, git-ignored collection of upstream repositories for AI video-generation workflow research.

### Modified Capabilities

None.

## Impact

- New repository metadata and documentation at the repository root.
- Local clones under `references/` are intentionally excluded from the parent repository’s version control.
- No upstream reference source code is modified.
- No application runtime, dependencies, or production code are introduced.
