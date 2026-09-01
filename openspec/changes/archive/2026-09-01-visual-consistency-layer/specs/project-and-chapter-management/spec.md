## ADDED Requirements

### Requirement: Preserve story and media when visual inputs change
Project and chapter management SHALL treat visual profile and Style Bible revisions as separate descendants of story content. Updating a visual profile SHALL not change chapter text, StoryState, scene source ranges, TTS, subtitles, background assets, or render outputs.

#### Scenario: Change a character appearance
- **WHEN** a user changes one character's approved visual profile
- **THEN** only dependent visual prompt packages SHALL become stale while the chapter and media pipeline remain valid

#### Scenario: Change the project style
- **WHEN** a user changes the current Style Bible
- **THEN** visual packages SHALL become stale without invalidating authored story or completed audio/render outputs

### Requirement: Persist visual identity across restart
Visual profiles, current revisions, package statuses, fingerprints, and consistency results SHALL be persisted with project ownership and SHALL be recovered by normal project reads after API or worker restart.

#### Scenario: Reload a project
- **WHEN** the application restarts after profiles and packages were saved
- **THEN** the project SHALL expose the same current visual identities and stale/current statuses rather than resetting them
