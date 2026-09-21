import type { AskAgentResult } from 'core';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatShowPrompt, registerAskCommand } from './ask-command.js';

function makeResult(overrides: Partial<AskAgentResult> = {}): AskAgentResult {
  return {
    answer: 'Budapest a fővárosa.',
    messages: [{ role: 'user', content: 'Mi Magyarország fővárosa?' }],
    system: '<role>test</role>',
    usage: { inputTokens: 10, outputTokens: 5 },
    logPath: '/fake/logs/whatever.jsonl',
    escalated: false,
    ...overrides,
  };
}

describe('formatShowPrompt', () => {
  it('includes the system prompt and the message array as JSON', () => {
    const output = formatShowPrompt('<role>x</role>', [
      { role: 'user', content: 'hi' },
    ]);

    expect(output).toContain('show-prompt');
    expect(output).toContain('<role>x</role>');
    expect(output).toContain('"role": "user"');
    expect(output).toContain('"content": "hi"');
  });
});

describe('registerAskCommand (one-shot mode)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  it('calls askAgent with the question and prints the answer', async () => {
    const askAgent = vi.fn().mockResolvedValue(makeResult());
    const program = new Command();
    registerAskCommand(program, { askAgent });

    await program.parseAsync(['ask', 'Mi Magyarország fővárosa?'], {
      from: 'user',
    });

    expect(askAgent).toHaveBeenCalledWith('Mi Magyarország fővárosa?');
    expect(logSpy).toHaveBeenCalledWith('Budapest a fővárosa.');
  });

  it('prints the full message array when --show-prompt is set', async () => {
    const askAgent = vi.fn().mockResolvedValue(makeResult());
    const program = new Command();
    registerAskCommand(program, { askAgent });

    await program.parseAsync(['ask', 'valami kérdés', '--show-prompt'], {
      from: 'user',
    });

    const promptOutput = logSpy.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('show-prompt'),
    )?.[0] as string;
    expect(promptOutput).toBeDefined();
    expect(promptOutput).toContain('<role>test</role>');
    expect(logSpy).toHaveBeenCalledWith('Budapest a fővárosa.');
  });

  it('reports an error and sets a non-zero exit code when askAgent rejects', async () => {
    const askAgent = vi.fn().mockRejectedValue(new Error('boom'));
    const program = new Command();
    registerAskCommand(program, { askAgent });

    await program.parseAsync(['ask', 'valami'], { from: 'user' });

    expect(errorSpy).toHaveBeenCalledWith('Error: boom');
    expect(process.exitCode).toBe(1);
  });
});
