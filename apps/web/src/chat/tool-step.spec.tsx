import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolStep } from './tool-step';

describe('ToolStep', () => {
  it('should show the Hungarian label and "fut…" while the tool runs', () => {
    const html = renderToStaticMarkup(
      <ToolStep
        part={{
          type: 'tool-runSql',
          state: 'input-available',
          input: { sql: 'SELECT 1' },
        }}
      />,
    );

    expect(html).toContain('Adatbázis-lekérdezés');
    expect(html).toContain('fut…');
    expect(html).not.toContain('Eredmény');
  });

  it('should show a runSql input as plain SQL, not JSON', () => {
    const html = renderToStaticMarkup(
      <ToolStep
        part={{
          type: 'tool-runSql',
          state: 'input-available',
          input: { sql: 'SELECT name FROM products' },
        }}
      />,
    );

    expect(html).toContain('<pre>SELECT name FROM products</pre>');
  });

  it('should show the result when the tool succeeded', () => {
    const html = renderToStaticMarkup(
      <ToolStep
        part={{
          type: 'tool-runSql',
          state: 'output-available',
          input: { sql: 'SELECT 1' },
          output: { ok: true, data: { rowCount: 1 } },
        }}
      />,
    );

    expect(html).toContain('kész');
    expect(html).toContain('Eredmény');
    expect(html).toContain('&quot;rowCount&quot;: 1');
  });

  it('should show the error when the tool returned ok:false', () => {
    const html = renderToStaticMarkup(
      <ToolStep
        part={{
          type: 'tool-runSql',
          state: 'output-available',
          input: { sql: 'DELETE FROM products' },
          output: { ok: false, error: 'Only SELECT is allowed.' },
        }}
      />,
    );

    expect(html).toContain('hiba');
    expect(html).toContain('Only SELECT is allowed.');
    expect(html).not.toContain('Eredmény');
  });

  it('should render collapsed by default', () => {
    const html = renderToStaticMarkup(
      <ToolStep
        part={{
          type: 'tool-listCategories',
          state: 'input-available',
          input: {},
        }}
      />,
    );

    expect(html).toMatch(/^<details(?![^>]*\sopen)/);
  });
});
