import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from './assistant-markdown';

function render(text: string): string {
  return renderToStaticMarkup(<AssistantMarkdown text={text} />);
}

const SAFE_LINK_ATTRIBUTES =
  /target="_blank" rel="noopener noreferrer nofollow"/;

describe('AssistantMarkdown', () => {
  describe('formatting', () => {
    it('should render bold, lists and code when the answer uses Markdown', () => {
      const html = render(
        '**Monstera**\n\n- fény: közepes\n- öntözés: heti\n\n```sql\nSELECT 1\n```',
      );

      expect(html).toContain('<strong>Monstera</strong>');
      expect(html).toMatch(/<ul>\s*<li>fény: közepes<\/li>/);
      expect(html).toMatch(/<pre><code[^>]*>SELECT 1/);
    });

    it('should wrap a GFM table in a horizontally scrolling box when the answer has a table', () => {
      const html = render(
        '| Név | Ár |\n| --- | --- |\n| Kaktusz | 2 990 Ft |',
      );

      expect(html).toMatch(/<div class="_tableScroll_[^"]*"><table>/);
      expect(html).toContain('<td>Kaktusz</td>');
    });

    it('should use the markdown wrapper instead of the pre-wrap text class', () => {
      const html = render('Szia');

      expect(html).toMatch(/^<div class="_markdown_/);
      expect(html).not.toMatch(/class="_text_/);
    });
  });

  describe('raw HTML', () => {
    it('should drop raw HTML when the answer contains script, iframe or an event handler', () => {
      const html = render(
        'a <script>alert(1)</script> b\n\n<iframe src="https://evil.example"></iframe>\n\n<img src=x onerror="alert(1)">',
      );

      expect(html).not.toContain('<script');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('onerror');
      expect(html).not.toContain('<img');
    });

    it('should show HTML as escaped text when it sits in a code block', () => {
      const html = render('```html\n<script>alert(1)</script>\n```');

      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script');
    });
  });

  describe('images', () => {
    it('should render nothing of an image when the answer embeds one', () => {
      const html = render('Nézd: ![titkos alt](https://evil.example/?d=titok)');

      expect(html).not.toContain('<img');
      expect(html).not.toContain('evil.example');
      expect(html).not.toContain('titkos alt');
      expect(html).toContain('Nézd:');
    });
  });

  describe('links', () => {
    it.each([
      ['javascript:', '[katt](javascript:alert(1))'],
      ['mixed-case javascript:', '[katt](JaVaScRiPt:alert(1))'],
      ['vbscript:', '[katt](vbscript:msgbox(1))'],
      [
        'data:',
        '[katt](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      ],
      ['a tab-split javascript:', '[katt](java&#x09;script:alert(1))'],
      [
        'a reference-style javascript:',
        '[katt][r]\n\n[r]: javascript:alert(1)',
      ],
      ['a protocol-relative URL', '[katt](//evil.example)'],
      ['a relative URL', '[katt](/admin)'],
    ])(
      'should keep the text but drop the link when the URL is %s',
      (_label, markdown) => {
        const html = render(markdown);

        expect(html).not.toContain('<a');
        expect(html).toContain('katt');
      },
    );

    it.each([
      ['an https link', '[Pelda](https://pelda.hu)', 'https://pelda.hu'],
      ['a mailto link', '[írj](mailto:info@pelda.hu)', 'mailto:info@pelda.hu'],
      ['a bare www autolink', 'Lásd: www.pelda.hu', 'http://www.pelda.hu'],
      [
        'a bare https autolink',
        'Lásd: https://pelda.hu/a',
        'https://pelda.hu/a',
      ],
    ])(
      'should open %s in a new tab with safe attributes',
      (_label, markdown, href) => {
        const html = render(markdown);

        expect(html).toContain(`href="${href}"`);
        expect(html).toMatch(SAFE_LINK_ATTRIBUTES);
      },
    );
  });

  it('should be memoized so finished answers are not re-parsed while another streams', () => {
    expect(
      (AssistantMarkdown as unknown as { $$typeof: symbol }).$$typeof,
    ).toBe(Symbol.for('react.memo'));
  });
});
