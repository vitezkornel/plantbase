import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerAdminCommand,
  type AdminCommandResult,
} from './admin-command.js';

function makeResult(): AdminCommandResult {
  return {
    answer: 'Kész: 3 fikusz bekerült a katalógusba.',
    toolCalls: ['ingestProduct'],
    logPath: '/fake/logs/admin.jsonl',
  };
}

describe('registerAdminCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  it('should call the admin agent with the request, print the answer and close connections', async () => {
    const adminAgent = vi.fn().mockResolvedValue(makeResult());
    const closeConnections = vi.fn().mockResolvedValue(undefined);
    const program = new Command();
    registerAdminCommand(program, { adminAgent, closeConnections });

    await program.parseAsync(['admin', 'tölts be 3 fikuszt'], { from: 'user' });

    expect(adminAgent).toHaveBeenCalledWith('tölts be 3 fikuszt');
    expect(logSpy).toHaveBeenCalledWith(
      'Kész: 3 fikusz bekerült a katalógusba.',
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('ingestProduct'),
    );
    expect(closeConnections).toHaveBeenCalledTimes(1);
  });

  it('should report an error, set a non-zero exit code and still close connections', async () => {
    const adminAgent = vi.fn().mockRejectedValue(new Error('boom'));
    const closeConnections = vi.fn().mockResolvedValue(undefined);
    const program = new Command();
    registerAdminCommand(program, { adminAgent, closeConnections });

    await program.parseAsync(['admin', 'valami'], { from: 'user' });

    expect(errorSpy).toHaveBeenCalledWith('Error: boom');
    expect(process.exitCode).toBe(1);
    expect(closeConnections).toHaveBeenCalledTimes(1);
  });
});
