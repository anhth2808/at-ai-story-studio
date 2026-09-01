import {
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
} from '@oh-my-pi/pi-coding-agent';
import {
  DEFAULT_OMP_MODEL,
  ompProtocolErrorSchema,
  ompProtocolRequestSchema,
  ompProtocolResultSchema,
  type OmpProtocolRequest,
} from '@studio/shared';
import type { AgentSession } from '@oh-my-pi/pi-coding-agent';

type SessionEventSnapshot = {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string; error?: string };
  messages?: Array<{
    role?: string;
    stopReason?: string;
    errorMessage?: string;
    usage?: {
      input?: number;
      output?: number;
      cost?: { total?: number };
    };
  }>;
  telemetry?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
    };
    cost?: {
      estimatedUsd?: number;
      unavailableReasons?: readonly string[];
    };
    chats?: {
      byStopReason?: Readonly<Record<string, number>>;
    };
  };
};

const MAX_LINE_BYTES = 2_500_000;
const write = (value: unknown): void => process.stdout.write(`${JSON.stringify(value)}\n`);

function selectModel(modelRegistry: ModelRegistry, selector: string) {
  const separator = selector.indexOf('/');
  if (separator > 0)
    return modelRegistry.find(selector.slice(0, separator), selector.slice(separator + 1));
  return modelRegistry.getAvailable().find((candidate) => candidate.id === selector);
}

function errorCode(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('context')) return 'CONTEXT_ERROR';
  if (normalized.includes('structured') || normalized.includes('json'))
    return 'STRUCTURED_OUTPUT_ERROR';
  if (normalized.includes('budget') || normalized.includes('cost')) return 'BUDGET_ERROR';
  return 'PROVIDER_ERROR';
}

function errorEvent(
  request: Partial<OmpProtocolRequest>,
  code: string,
  message: string,
  retryable: boolean,
) {
  const codeResult = ompProtocolErrorSchema.shape.code.safeParse(code);
  const correlationId =
    typeof request.correlationId === 'string' && /^[0-9a-f-]{36}$/i.test(request.correlationId)
      ? request.correlationId
      : '00000000-0000-0000-0000-000000000000';
  return ompProtocolErrorSchema.parse({
    kind: 'error',
    version: 1,
    correlationId,
    code: codeResult.success ? codeResult.data : 'HOST_ERROR',
    message: message.slice(0, 500),
    retryable,
  });
}

function parseRequest(line: string): OmpProtocolRequest {
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)
    throw new Error('Protocol request is too large');
  return ompProtocolRequestSchema.parse(JSON.parse(line));
}

async function run(request: OmpProtocolRequest): Promise<void> {
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
  const modelSelector = request.model ?? DEFAULT_OMP_MODEL;
  const selected = selectModel(modelRegistry, modelSelector);
  if (!selected) {
    write(
      errorEvent(
        request,
        'MODEL_ERROR',
        `Configured OMP model is unavailable: ${modelSelector}`,
        false,
      ),
    );
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
  let telemetry: SessionEventSnapshot['telemetry'];
  let finishReason: string | null = null;
  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
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
      const candidate = event as SessionEventSnapshot;
      if (candidate.type === 'agent_end') {
        const assistant = candidate.messages
          ?.filter((message) => message.role === 'assistant')
          .at(-1);
        telemetry = candidate.telemetry;
        if (assistant?.usage) {
          telemetry = {
            usage: {
              inputTokens: assistant.usage.input,
              outputTokens: assistant.usage.output,
            },
            cost: {
              estimatedUsd: assistant.usage.cost?.total,
              unavailableReasons: [],
            },
          };
        }
        if (assistant?.errorMessage || assistant?.stopReason === 'error')
          eventError = assistant.errorMessage ?? 'OMP provider returned an error';
        const stopReasons = Object.entries(candidate.telemetry?.chats?.byStopReason ?? {}).sort(
          (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
        );
        finishReason = stopReasons[0]?.[0] ?? assistant?.stopReason ?? null;
      }
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
    if (eventError) throw new Error(eventError);
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
    const usage = telemetry?.usage;
    const cost = telemetry?.cost;
    const unavailableReasons = cost?.unavailableReasons ?? [];
    const result = ompProtocolResultSchema.parse({
      kind: 'result',
      version: 1,
      correlationId: request.correlationId,
      operation: request.operation,
      text: text.trim(),
      provider: selected.provider,
      model: selected.id,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd:
        typeof cost?.estimatedUsd === 'number' && unavailableReasons.length === 0
          ? cost.estimatedUsd
          : null,
      costCurrency: null,
      finishReason,
      durationMs: Date.now() - startedAt,
    });
    write(result);
  } catch (error) {
    const aborted = controller.signal.aborted;
    const message = error instanceof Error ? error.message : 'OMP provider request failed';
    write(
      errorEvent(
        request,
        aborted ? 'TIMEOUT' : errorCode(message),
        aborted ? 'OMP generation timed out' : message,
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
    const selected = selectModel(modelRegistry, DEFAULT_OMP_MODEL);
    write({
      ready: Boolean(selected),
      runtime: `bun ${Bun.version}`,
      model: selected ? `${selected.provider}/${selected.id}` : null,
      message: selected
        ? 'OMP authentication and model discovery are ready'
        : `Default OMP model is unavailable: ${DEFAULT_OMP_MODEL}`,
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
