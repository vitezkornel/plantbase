import { describe, expect, it } from 'vitest';
import { safeErrorFields } from './safe-error-fields';

describe('safeErrorFields', () => {
  it('should keep only the name and status code of a provider error', () => {
    const error = Object.assign(new Error('boom: TITKOS mondat'), {
      name: 'AI_APICallError',
      statusCode: 429,
      requestBodyValues: { input: 'TITKOS mondat' },
    });

    const fields = safeErrorFields(error);

    expect(fields).toEqual({ errorName: 'AI_APICallError', statusCode: 429 });
    expect(JSON.stringify(fields)).not.toContain('TITKOS');
  });

  it('should handle a thrown non-object', () => {
    expect(safeErrorFields('x')).toEqual({ errorName: 'NonError' });
  });
});
