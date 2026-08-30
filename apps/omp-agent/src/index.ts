import {
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
} from '@oh-my-pi/pi-coding-agent';

type GenerationOperation = 'BLUEPRINT' | 'CHAPTER_PLANS' | 'CHAPTER' | 'CHAPTER_SUMMARY';
type Request = {
  kind: 'request';
  version: 1;
  correlationId: string;
  operation: GenerationOperation;
  model: string | null;
  promptVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  systemPrompt: string;
  userPrompt: string;
  deadlineMs: number;
};

const MAX_LINE_BYTES = 2_500_000;
const generationOperations = new Set<GenerationOperation>([
  'BLUEPRINT',
  'CHAPTER_PLANS',
  'CHAPTER',
  'CHAPTER_SUMMARY',
]);
const write = (value: unknown): void => process.stdout.write(`${JSON.stringify(value)}\n`);
const errorEvent = (
  request: Partial<Request>,
  code: string,
  message: string,
  retryable: boolean,
) => ({
  kind: 'error',
  version: 1,
  correlationId: request.correlationId ?? '00000000-0000-0000-0000-000000000000',
  code,
  message: message.slice(0, 500),
  retryable,
});

function parseRequest(line: string): Request {
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)
    throw new Error('Protocol request is too large');
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Protocol request must be an object');
  const request = value as Partial<Request>;
  if (
    request.kind !== 'request' ||
    request.version !== 1 ||
    typeof request.correlationId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(request.correlationId) ||
    typeof request.operation !== 'string' ||
    !generationOperations.has(request.operation as GenerationOperation) ||
    typeof request.systemPrompt !== 'string' ||
    request.systemPrompt.length > 200_000 ||
    typeof request.userPrompt !== 'string' ||
    request.userPrompt.length > 2_000_000 ||
    typeof request.inputFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.inputFingerprint) ||
    typeof request.promptVersion !== 'string' ||
    request.promptVersion.length > 80 ||
    typeof request.schemaVersion !== 'string' ||
    request.schemaVersion.length > 80 ||
    typeof request.deadlineMs !== 'number' ||
    !Number.isInteger(request.deadlineMs) ||
    request.deadlineMs < 1_000 ||
    request.deadlineMs > 600_000
  )
    throw new Error('Protocol request is invalid');
  return request as Request;
}

async function run(request: Request): Promise<void> {
  const startedAt = Date.now();
  write({
    kind: 'progress',
    version: 1,
    correlationId: request.correlationId,
    stage: 'STARTING',
    message: 'Starting isolated OMP session',
  });
  const authStorage = await discoverAuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  const available = modelRegistry.getAvailable();
  const selected = request.model
    ? (() => {
        const separator = request.model!.indexOf('/');
        if (separator > 0)
          return modelRegistry.find(
            request.model!.slice(0, separator),
            request.model!.slice(separator + 1),
          );
        return available.find((candidate) => candidate.id === request.model);
      })()
    : available[0];
  if (!selected) {
    write(errorEvent(request, 'MODEL_ERROR', 'No authenticated OMP model is available', false));
    return;
  }
  write({
    kind: 'progress',
    version: 1,
    correlationId: request.correlationId,
    stage: 'AUTHENTICATING',
    message: 'OMP model is configured',
  });
  const controller = new AbortController();
  let text = '';
  let eventError: string | null = null;
  let unsubscribe: (() => void) | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  const timer = setTimeout(() => {
    controller.abort();
    session?.abort('Story generation deadline exceeded');
  }, request.deadlineMs);
  try {
    const created = await createAgentSession({
      cwd: process.env.STUDIO_WORKSPACE ?? process.cwd(),
      authStorage,
      modelRegistry,
      model: selected,
      settings: Settings.isolated({}),
      sessionManager: SessionManager.inMemory(process.env.STUDIO_WORKSPACE ?? process.cwd()),
      systemPrompt: request.systemPrompt,
      disableExtensionDiscovery: true,
      enableMCP: false,
      enableLsp: false,
      toolNames: [],
      restrictToolNames: true,
      allowRestrictedCustomTools: false,
    });
    session = created.session;
    unsubscribe = session.subscribe((event) => {
      const candidate = event as {
        type?: string;
        assistantMessageEvent?: { type?: string; delta?: string; error?: string };
      };
      if (candidate.type !== 'message_update') return;
      const update = candidate.assistantMessageEvent;
      if (update?.type === 'text_delta' && update.delta) text += update.delta;
      if (update?.type === 'error') eventError = update.error ?? 'OMP provider error';
    });
    write({
      kind: 'progress',
      version: 1,
      correlationId: request.correlationId,
      stage: 'GENERATING',
      message: 'Generating structured story result',
    });
    await session.prompt(request.userPrompt);
    if (eventError) throw new Error('OMP provider returned an error');
    if (controller.signal.aborted) {
      write(errorEvent(request, 'TIMEOUT', 'OMP generation timed out', true));
      return;
    }
    if (!text.trim()) throw new Error('OMP returned an empty result');
    write({
      kind: 'progress',
      version: 1,
      correlationId: request.correlationId,
      stage: 'PARSING',
      message: 'Validating structured story result',
    });
    write({
      kind: 'result',
      version: 1,
      correlationId: request.correlationId,
      operation: request.operation,
      text: text.trim(),
      provider: selected.provider,
      model: selected.id,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: Date.now() - startedAt,
    });
  } catch {
    const aborted = controller.signal.aborted;
    write(
      errorEvent(
        request,
        aborted ? 'TIMEOUT' : 'PROVIDER_ERROR',
        aborted ? 'OMP generation timed out' : 'OMP provider request failed',
        !aborted,
      ),
    );
  } finally {
    clearTimeout(timer);
    unsubscribe?.();
    await session?.dispose();
  }
}

async function reportReadiness(): Promise<void> {
  try {
    const authStorage = await discoverAuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);
    await modelRegistry.refresh();
    const selected = modelRegistry.getAvailable()[0];
    write({
      ready: Boolean(selected),
      runtime: `bun ${Bun.version}`,
      model: selected ? `${selected.provider}/${selected.id}` : null,
      message: selected
        ? 'OMP authentication and model discovery are ready'
        : 'No authenticated OMP model is available',
    });
  } catch {
    write({
      ready: false,
      runtime: `bun ${Bun.version}`,
      model: null,
      message: 'OMP authentication or model discovery is not ready',
    });
  }
}

if (process.argv.includes('--readiness')) {
  await reportReadiness();
} else {
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk.toString();
    const newline = buffer.indexOf('\n');
    if (newline < 0) continue;
    const line = buffer.slice(0, newline).trim();
    try {
      const request = parseRequest(line);
      await run(request);
    } catch (error) {
      write(
        errorEvent(
          {},
          'PROTOCOL_ERROR',
          error instanceof Error ? error.message : 'Invalid request',
          false,
        ),
      );
    }
    break;
  }
}
