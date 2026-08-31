## ADDED Requirements

### Requirement: Long-story OMP operation contracts
The controlled OMP boundary SHALL support separate typed requests and terminal structured results for arc planning, bounded chapter-plan windows, long-story chapter generation, StateDelta or manual chapter analysis, and optional continuity checks. These operations SHALL use the same isolated session and protocol safety guarantees as existing Story operations, and OMP SDK-specific types SHALL not cross the application boundary.

#### Scenario: Run bounded chapter generation
- **WHEN** the worker submits a chapter-generation request with a bounded GenerationContext and current input fingerprint
- **THEN** the OMP boundary SHALL return one validated transport result containing structured chapter data and provenance without mutating SQLite or project files directly

#### Scenario: Run continuity analysis
- **WHEN** an enabled continuity or manual-analysis operation is requested
- **THEN** the boundary SHALL execute it as an explicit typed operation and SHALL return structured data or a safe classified failure without automatically scheduling regeneration

### Requirement: Usage and diagnostics propagation
When the OMP runtime or configured provider exposes token, duration, model, provider, or cost information, the boundary SHALL propagate only bounded non-secret values to the application. Missing values SHALL remain null. Protocol and host diagnostics SHALL remain bounded and SHALL not include complete prompts, chapter prose, or credentials.

#### Scenario: Propagate available usage
- **WHEN** an OMP result includes input and output token counts
- **THEN** the application SHALL receive those values with operation and attempt provenance for persistence in usage records

#### Scenario: Omit unavailable cost
- **WHEN** the OMP runtime does not expose token or cost metadata
- **THEN** the boundary SHALL still return a valid structured result with null usage fields and SHALL not fabricate values

### Requirement: Stable long-story error categories
The OMP boundary SHALL map host, provider, protocol, timeout, cancellation, context, and structured-output failures into stable safe categories usable by the durable story workflow. A continuity-check FAIL SHALL be returned as a structured evaluation result rather than an infrastructure retry signal.

#### Scenario: Host loss during a batch chapter
- **WHEN** the isolated OMP host exits before returning a terminal result
- **THEN** the boundary SHALL return a retryable host or infrastructure category, SHALL not promote partial output, and SHALL allow durable batch recovery

#### Scenario: Cancel an OMP operation
- **WHEN** durable workflow cancellation reaches an active long-story operation
- **THEN** the boundary SHALL stop the session/process, return a cancelled category, and SHALL not emit a successful terminal result