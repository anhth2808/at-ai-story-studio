# Filesystem

The default workspace is `workspace/` at the repository root. Override it with `STUDIO_WORKSPACE`.

```text
workspace/
  studio.db
  projects/{projectId}/
    chapters/
    audio/
      segments/
    subtitles/
    backgrounds/
    music/
    renders/
  staging/{attemptId}/
```

SQLite stores only metadata and workflow state. Audio, images, video, SRT, temporary files, and rendered MP4 files stay on disk.

Uploaded names are used only for display and a safe extension. Internal paths use generated IDs. API asset lookup resolves only workspace-relative paths and rejects absolute paths, NUL bytes, traversal, and escaped roots. Outputs are written under an attempt staging directory, probed and hashed, then promoted to a project directory. A `.partial` destination is removed before promotion; it is never registered as current.

SHA-256 is streamed from files, so hashing does not load a complete media file into memory. Multipart uploads stream to disk through Node's pipeline API.
