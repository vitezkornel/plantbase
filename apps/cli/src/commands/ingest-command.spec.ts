import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerIngestCommand,
  type IngestCommandResult,
} from './ingest-command.js';

function makeResult(): IngestCommandResult {
  return {
    answer: '3 új fikusz került be.',
    toolCalls: ['scrapeProducts', 'upsertProducts'],
    logPath: '/fake/logs/ingest.jsonl',
  };
}

describe('registerIngestCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  it('should call the ingest agent with the request, print the answer and close the DB connection', async () => {
    const ingestProduct = vi.fn().mockResolvedValue(makeResult());
    const closeConnections = vi.fn().mockResolvedValue(undefined);
    const program = new Command();
    registerIngestCommand(program, { ingestProduct, closeConnections });

    await program.parseAsync(['ingest', 'frissítsd a fikuszokat'], {
      from: 'user',
    });

    expect(ingestProduct).toHaveBeenCalledWith('frissítsd a fikuszokat');
    expect(logSpy).toHaveBeenCalledWith('3 új fikusz került be.');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('scrapeProducts → upsertProducts'),
    );
    expect(closeConnections).toHaveBeenCalledTimes(1);
  });

  it('should report an error, set a non-zero exit code and still close the connection', async () => {
    const ingestProduct = vi.fn().mockRejectedValue(new Error('boom'));
    const closeConnections = vi.fn().mockResolvedValue(undefined);
    const program = new Command();
    registerIngestCommand(program, { ingestProduct, closeConnections });

    await program.parseAsync(['ingest', 'valami'], { from: 'user' });

    expect(errorSpy).toHaveBeenCalledWith('Error: boom');
    expect(process.exitCode).toBe(1);
    expect(closeConnections).toHaveBeenCalledTimes(1);
  });

  it('should require a request argument', async () => {
    const ingestProduct = vi.fn();
    const program = new Command().exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    registerIngestCommand(program, { ingestProduct });

    await expect(
      program.parseAsync(['ingest'], { from: 'user' }),
    ).rejects.toThrow();
    expect(ingestProduct).not.toHaveBeenCalled();
  });
});
