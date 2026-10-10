// Turns one tool part of a chat message (`tool-<name>`, as streamed by the
// `ai` package) into what the UI shows. The ask-agent's tools never throw:
// they return a ToolOutcome (`{ ok, data }` / `{ ok: false, error }`), so a
// failed step usually arrives as `output-available` with `ok: false` — only
// SDK-level failures (e.g. invalid input) arrive as `output-error`.

export type ToolStepStatus = 'running' | 'done' | 'failed';

/** The subset of the `ai` package's ToolUIPart this view needs. */
export interface ToolPartLike {
  type: `tool-${string}`;
  state:
    'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input: unknown;
  output?: unknown;
  errorText?: string;
}

export interface ToolStepView {
  toolName: string;
  label: string;
  status: ToolStepStatus;
  input: unknown;
  data?: unknown;
  error?: string;
}

const TOOL_LABELS: Record<string, string> = {
  runSql: 'Adatbázis-lekérdezés',
  listCategories: 'Kategóriák listázása',
  searchKnowledge: 'Keresés a tudásbázisban',
  customerPreferences: 'Vásárlói preferenciák',
};

export function describeToolStep(part: ToolPartLike): ToolStepView {
  const toolName = part.type.slice('tool-'.length);
  const base = {
    toolName,
    label: TOOL_LABELS[toolName] ?? toolName,
    input: part.input,
  };

  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return { ...base, status: 'running' };
    case 'output-error':
      return {
        ...base,
        status: 'failed',
        error: part.errorText ?? 'Ismeretlen hiba.',
      };
    case 'output-available':
      return describeOutcome(base, part.output);
  }
}

function describeOutcome(
  base: Omit<ToolStepView, 'status'>,
  output: unknown,
): ToolStepView {
  if (isFailedOutcome(output)) {
    return { ...base, status: 'failed', error: output.error };
  }
  const data = isOkOutcome(output) ? output.data : output;
  return { ...base, status: 'done', data };
}

function isFailedOutcome(
  output: unknown,
): output is { ok: false; error: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'ok' in output &&
    output.ok === false &&
    'error' in output &&
    typeof output.error === 'string'
  );
}

function isOkOutcome(output: unknown): output is { ok: true; data: unknown } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'ok' in output &&
    output.ok === true
  );
}
