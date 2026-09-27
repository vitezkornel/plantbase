import { describe, expect, it, vi } from 'vitest';
import { executeIngestProduct } from './ingest-product-tool.js';

const innerResult = {
  answer: '3 fikusz került be.',
  toolCalls: ['scrapeProducts', 'upsertProducts'],
  logPath: '/fake/logs/ingest.jsonl',
};

describe('executeIngestProduct', () => {
  it('should run the inner ingest agent with the request and return its summary as a ToolOutcome', async () => {
    const ingestProduct = vi.fn().mockResolvedValue(innerResult);

    const outcome = await executeIngestProduct(
      { request: 'tölts be 3 fikuszt' },
      { ingestProduct },
    );

    expect(ingestProduct).toHaveBeenCalledWith('tölts be 3 fikuszt');
    expect(outcome).toEqual({ ok: true, data: innerResult });
  });

  it('should return an error outcome (not throw) when the inner agent fails', async () => {
    const ingestProduct = vi
      .fn()
      .mockRejectedValue(new Error('Agent loop exceeded the maximum'));

    const outcome = await executeIngestProduct(
      { request: 'tölts be mindent' },
      { ingestProduct },
    );

    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining('maximum'),
    });
  });

  it('should reject an empty request without starting the inner agent', async () => {
    const ingestProduct = vi.fn();

    const outcome = await executeIngestProduct(
      { request: '' },
      { ingestProduct },
    );

    expect(outcome.ok).toBe(false);
    expect(ingestProduct).not.toHaveBeenCalled();
  });
});
