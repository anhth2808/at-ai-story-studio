CREATE TRIGGER IF NOT EXISTS projects_status_check
BEFORE INSERT ON projects
WHEN NEW.status NOT IN ('ACTIVE', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'invalid project status'); END;

CREATE TRIGGER IF NOT EXISTS chapters_status_check
BEFORE INSERT ON chapters
WHEN NEW.status NOT IN ('ACTIVE', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'invalid chapter status'); END;

CREATE TRIGGER IF NOT EXISTS workflow_executions_status_check
BEFORE INSERT ON workflow_executions
WHEN NEW.status NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'invalid workflow execution status'); END;

CREATE TRIGGER IF NOT EXISTS workflow_steps_status_check
BEFORE INSERT ON workflow_steps
WHEN NEW.status NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'invalid workflow step status'); END;

CREATE TRIGGER IF NOT EXISTS workflow_attempts_status_check
BEFORE INSERT ON workflow_step_attempts
WHEN NEW.status NOT IN ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'invalid workflow attempt status'); END;

CREATE TRIGGER IF NOT EXISTS jobs_status_check
BEFORE INSERT ON jobs
WHEN NEW.status NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'invalid job status'); END;

CREATE TRIGGER IF NOT EXISTS assets_status_check
BEFORE INSERT ON assets
WHEN NEW.status NOT IN ('READY', 'INVALID')
BEGIN SELECT RAISE(ABORT, 'invalid asset status'); END;

CREATE TRIGGER IF NOT EXISTS tts_segments_status_check
BEFORE INSERT ON tts_segments
WHEN NEW.status NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'invalid tts segment status'); END;

CREATE TRIGGER IF NOT EXISTS render_jobs_status_check
BEFORE INSERT ON render_jobs
WHEN NEW.status NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'invalid render job status'); END;
