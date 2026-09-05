## ADDED Requirements

### Requirement: Bounded future-reveal Character resolution
When a current chapter contains an unnamed or aliased Character who may be identified later, the Story workflow MAY inspect bounded planned future context, chapter summaries, or a capped look-ahead window to resolve one canonical Character identity before creating durable visual or voice resources. The result SHALL retain alias, evidence source, confidence, and resolution status and SHALL not load unbounded future novel text or create Characters absent from the current chapter.

#### Scenario: Later reveal identifies an alias
- **WHEN** the current chapter introduces `Mysterious Man` and bounded later plan context explicitly reveals him as existing Character John Smith
- **THEN** the current occurrence SHALL resolve to John Smith's stable Character ID with provenance and SHALL not create a second canonical identity, reference set, or voice identity

#### Scenario: Future identity remains uncertain
- **WHEN** bounded future context does not establish a unique identity
- **THEN** the occurrence SHALL remain an unresolved alias for review and SHALL not be silently merged with a plausible Character
