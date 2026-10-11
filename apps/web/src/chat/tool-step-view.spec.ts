import { describe, expect, it } from 'vitest';
import { describeToolStep } from './tool-step-view';

describe('describeToolStep', () => {
  it('should show a known tool with its Hungarian label while its input is still arriving', () => {
    const view = describeToolStep({
      type: 'tool-runSql',
      state: 'input-streaming',
      input: undefined,
    });

    expect(view).toMatchObject({
      toolName: 'runSql',
      label: 'Adatbázis-lekérdezés',
      status: 'running',
    });
  });

  it('should report a running step once the input is complete', () => {
    const view = describeToolStep({
      type: 'tool-runSql',
      state: 'input-available',
      input: { sql: 'SELECT 1' },
    });

    expect(view).toMatchObject({
      status: 'running',
      input: { sql: 'SELECT 1' },
    });
  });

  it('should report success with the data of an ok:true outcome', () => {
    const view = describeToolStep({
      type: 'tool-listCategories',
      state: 'output-available',
      input: {},
      output: { ok: true, data: ['kaktusz'] },
    });

    expect(view).toMatchObject({
      label: 'Kategóriák listázása',
      status: 'done',
      data: ['kaktusz'],
    });
  });

  it('should report failure when the tool returned ok:false (not only on output-error)', () => {
    const view = describeToolStep({
      type: 'tool-runSql',
      state: 'output-available',
      input: { sql: 'DELETE FROM products' },
      output: { ok: false, error: 'Csak SELECT engedélyezett.' },
    });

    expect(view).toMatchObject({
      status: 'failed',
      error: 'Csak SELECT engedélyezett.',
    });
  });

  it('should report failure with the SDK error text on output-error', () => {
    const view = describeToolStep({
      type: 'tool-runSql',
      state: 'output-error',
      input: {},
      errorText: 'Invalid input',
    });

    expect(view).toMatchObject({ status: 'failed', error: 'Invalid input' });
  });

  it('should fall back to the raw tool name for an unknown tool', () => {
    const view = describeToolStep({
      type: 'tool-somethingNew',
      state: 'input-available',
      input: {},
    });

    expect(view).toMatchObject({
      toolName: 'somethingNew',
      label: 'somethingNew',
    });
  });
});
