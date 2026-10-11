# Markdown-megjelenítés az apps/web chatben — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cél:** az asszisztens válasza biztonságosan, formázott Markdownként jelenjen meg az `apps/web` chatben. Streamelés közben a félkész jelek ne villogjanak. A felhasználó üzenete sima szöveg marad.

**Architektúra:**
- Egy új, `React.memo`-s `AssistantMarkdown` komponensben él minden szabály, egy helyen:
  - react-markdown + remark-gfm;
  - `skipHtml`;
  - kép tiltva;
  - engedélylistás `urlTransform`;
  - saját `a` és `table`;
  - remend csak streamelés közben.
- A `MessageParts` az asszisztens szövegét ide küldi.
- A `ChatPanel` megmondja, melyik üzenet streamel.

**Tech stack:** Next.js 16 (webpack), React 19.3, `react-markdown@10.1.0`, `remark-gfm@4.0.1`, `remend@1.4.0`, Vitest (node környezet, `renderToStaticMarkup`), CSS-modulok.

**Spec:** `docs/superpowers/specs/2026-10-11-web-chat-markdown-design.md`

## Globális megkötések

- Csak az `apps/web` változik (és a 5. taskban a `CLAUDE.md`). A `core`, a `docs/system-prompt.md`, az `ask-agent-prompt.ts` és az `apps/customer-chat` **nem**.
- Verziók pontosan, `^` nélkül: `react-markdown` `10.1.0`, `remark-gfm` `4.0.1`, `remend` `1.4.0`.
- A `pnpm-workspace.yaml` `allowBuilds` nem változik. A `remend` lockfile-bejegyzése függőség nélküli.
- Nincs `rehype-raw`, és nincs `dangerouslySetInnerHTML`.
- Linkek: kizárólag a `/^(https?|mailto):/i` engedett. Az `<a>` attribútumai: `target="_blank" rel="noopener noreferrer nofollow"`.
- Az `img` elem tiltott, az alt-szöveg sem jelenik meg.
- A remend kizárólag `isStreaming === true` esetén fut.
- A `.markdown` `white-space: normal`. A user-üzenet `.text` osztálya `pre-wrap` marad.
- Tesztek: SSR (`renderToStaticMarkup`), jsdom nélkül. Tesztnév: „should … when …”. Cikk nélküli, angol kommentek, a környező kód sűrűségében.
- A CSS-modul osztálynevei a Vitestben `_<név>_<hash>` alakúak (próbával ellenőrizve: `styles.text` → `_text_ef6372`). Ezért a tesztek így illesztenek: `/class="_markdown_/`.
- Minden commit végén: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push, PR és merge csak kifejezett jóváhagyással.
- A prettier által nem érintett, független sorok újraformázását vissza kell állítani.

## Review fókusz

Öt eset, amit a spec sugall, de egy task saját tesztjei nem fednének le. Mindegyik tesztje a gazda-taskba került:

1. **Kódblokkban lévő HTML** (```` ```html\n<script>…</script>\n``` ````): látható, escape-elt szövegként kell megjelennie (`&lt;script&gt;`), nem eldobva és nem elemként. → 3. task
2. **Eszkalált válasz Markdownnal:** a jelvény és a formázott szöveg együtt jelenik meg, a `[ESCALATE]` prefix nem. → 3. task
3. **Több szöveges part egy üzenetben** (szöveg → tool → szöveg) streamelés közben: csak az utolsó szöveges partra fut a remend, a korábbi kész part érintetlen. → 4. task
4. **Üres szöveges part a stream elején:** nem dob hibát, és nem jelenik meg nyers jel. → 4. task
5. **HTML-szerű user-üzenet** (`<b>x</b>`): escape-elt sima szöveg, nem elem. → 3. task

---

### 1. task: spec és terv (`docs: add the web chat markdown design spec`)

**Fájlok:**
- Már commitolva: `docs/superpowers/specs/2026-10-11-web-chat-markdown-design.md` (`56f7f4b`)
- Új: `docs/superpowers/plans/2026-10-11-web-chat-markdown.md` (ez a fájl)

- [ ] **1. lépés: a terv hozzáadása az első commithoz** (a terv jóváhagyása után, push előtt)

```bash
git add docs/superpowers/plans/2026-10-11-web-chat-markdown.md
git commit --amend -m "docs: add the web chat markdown design spec and plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 2. task: függőségek (`build(web): add react-markdown, remark-gfm and remend at exact versions`)

**Fájlok:**
- Módosul: `apps/web/package.json` (`dependencies`)
- Módosul: `pnpm-lock.yaml`

**Interfészek:**
- Termel: a `react-markdown` (`default` export: `Markdown`, és `type Components`), a `remark-gfm` (`default`) és a `remend` (`default: (markdown: string) => string`) importálható az `apps/web`-ből.

- [ ] **1. lépés: telepítés pontos verzióval**

```bash
pnpm --filter web add --save-exact react-markdown@10.1.0 remark-gfm@4.0.1 remend@1.4.0
```

Elvárt: a kimenetben nincs „Ignored build scripts” vagy „approve-builds” figyelmeztetés új csomagra.

- [ ] **2. lépés: a verziók ellenőrzése**

```bash
git diff apps/web/package.json
```

Elvárt: három új sor `"react-markdown": "10.1.0"`, `"remark-gfm": "4.0.1"` és `"remend": "1.4.0"` értékkel. Nincs `^` és nincs `~`.

- [ ] **3. lépés: a remend függőségmentességének ellenőrzése**

```bash
grep -n -A6 "^  remend@1.4.0:" pnpm-lock.yaml
```

Elvárt: a `snapshots:` alatti `remend@1.4.0: {}` bejegyzés, `dependencies:` kulcs nélkül.

- [ ] **4. lépés: az allowBuilds változatlansága**

```bash
git diff --stat
```

Elvárt: csak az `apps/web/package.json` és a `pnpm-lock.yaml` változott. A `pnpm-workspace.yaml` nem.

- [ ] **5. lépés: a meglévő tesztek és a típusellenőrzés változatlanul zöldek**

```bash
pnpm nx run-many -t typecheck,test -p web
```

Elvárt: PASS, 37 teszt.

- [ ] **6. lépés: commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add react-markdown, remark-gfm and remend at exact versions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 3. task: biztonságos Markdown (`feat(web): render assistant answers as safe Markdown`)

**Fájlok:**
- Új: `apps/web/src/chat/assistant-markdown.tsx`
- Új: `apps/web/src/chat/assistant-markdown.spec.tsx`
- Módosul: `apps/web/src/chat/message-parts.tsx` (az asszisztens-ág)
- Módosul: `apps/web/src/chat/message-parts.spec.tsx`
- Módosul: `apps/web/src/chat/chat.module.css` (`.assistant`, új `.markdown`, `.tableScroll`)

**Interfészek:**
- Felhasznál: a 2. task csomagjait.
- Termel: `export const AssistantMarkdown: React.MemoExoticComponent<(props: AssistantMarkdownProps) => JSX.Element>`, ahol `export interface AssistantMarkdownProps { text: string }`. (A 4. task bővíti `isStreaming: boolean`-nel.)

- [ ] **1. lépés: a bukó tesztek megírása:** `apps/web/src/chat/assistant-markdown.spec.tsx`

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from './assistant-markdown';

function render(text: string): string {
  return renderToStaticMarkup(<AssistantMarkdown text={text} />);
}

const SAFE_LINK_ATTRIBUTES = /target="_blank" rel="noopener noreferrer nofollow"/;

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
      const html = render('| Név | Ár |\n| --- | --- |\n| Kaktusz | 2 990 Ft |');

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
      ['data:', '[katt](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
      ['a tab-split javascript:', '[katt](java&#x09;script:alert(1))'],
      ['a reference-style javascript:', '[katt][r]\n\n[r]: javascript:alert(1)'],
      ['a protocol-relative URL', '[katt](//evil.example)'],
      ['a relative URL', '[katt](/admin)'],
    ])('should keep the text but drop the link when the URL is %s', (_label, markdown) => {
      const html = render(markdown);

      expect(html).not.toContain('<a');
      expect(html).toContain('katt');
    });

    it.each([
      ['an https link', '[Pelda](https://pelda.hu)', 'https://pelda.hu'],
      ['a mailto link', '[írj](mailto:info@pelda.hu)', 'mailto:info@pelda.hu'],
      ['a bare www autolink', 'Lásd: www.pelda.hu', 'http://www.pelda.hu'],
      ['a bare https autolink', 'Lásd: https://pelda.hu/a', 'https://pelda.hu/a'],
    ])('should open %s in a new tab with safe attributes', (_label, markdown, href) => {
      const html = render(markdown);

      expect(html).toContain(`href="${href}"`);
      expect(html).toMatch(SAFE_LINK_ATTRIBUTES);
    });
  });

  it('should be memoized so finished answers are not re-parsed while another streams', () => {
    expect((AssistantMarkdown as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });
});
```

- [ ] **2. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/chat/assistant-markdown.spec.tsx
```

Elvárt: FAIL, „Failed to resolve import ./assistant-markdown”.

- [ ] **3. lépés: implementáció:** `apps/web/src/chat/assistant-markdown.tsx`

```tsx
import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './chat.module.css';

// The model's answer is untrusted input — it can carry a prompt injection
// from a tool result or a knowledge-base article. So: no raw HTML (no
// rehype-raw, and skipHtml), no images (a Markdown image is fetched by the
// browser on its own, which makes it a data-exfiltration channel), and an
// allowlist for links instead of react-markdown's blocklist-style default.
const SAFE_URL = /^(https?|mailto):/i;

/** Runs on the decoded URL; anything not allowlisted becomes plain text. */
function safeUrl(url: string): string {
  return SAFE_URL.test(url) ? url : '';
}

const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  table: ({ children }) => (
    <div className={styles.tableScroll}>
      <table>{children}</table>
    </div>
  ),
};

export interface AssistantMarkdownProps {
  text: string;
}

/**
 * The assistant's answer as Markdown. Memoized: while one answer streams,
 * the whole list re-renders on every chunk, but finished answers keep the
 * same props and are not parsed again.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
}: AssistantMarkdownProps) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        urlTransform={safeUrl}
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
});
```

- [ ] **4. lépés: CSS:** `apps/web/src/chat/chat.module.css`

A `.assistant` szabályba kerüljön a `min-width: 0;` sor. A `.text` szabály után pedig ez jön:

```css
/* Markdown elements bring their own spacing; pre-wrap would add blank lines. */
.markdown {
  white-space: normal;
  overflow-wrap: anywhere;
}

.markdown > :first-child {
  margin-top: 0;
}

.markdown > :last-child {
  margin-bottom: 0;
}

.markdown p,
.markdown ul,
.markdown ol,
.markdown pre,
.markdown .tableScroll {
  margin: 0 0 8px;
}

.markdown ul,
.markdown ol {
  padding-left: 1.25rem;
}

.markdown code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--code-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
}

.markdown pre {
  padding: 8px;
  border-radius: 6px;
  background: var(--code-bg);
  overflow-x: auto;
  white-space: pre;
}

.markdown pre code {
  padding: 0;
  background: none;
}

/* A wide table scrolls inside the bubble instead of stretching the page. */
.tableScroll {
  max-width: 100%;
  overflow-x: auto;
  overflow-wrap: normal;
}

.tableScroll table {
  border-collapse: collapse;
  font-size: 0.875rem;
}

.tableScroll th,
.tableScroll td {
  padding: 4px 8px;
  border: 1px solid var(--border);
  text-align: left;
}

.tableScroll th {
  white-space: nowrap;
  background: var(--bg);
}
```

- [ ] **5. lépés: a tesztek futtatása, sikeresnek kell lenniük**

```bash
pnpm nx test web -- src/chat/assistant-markdown.spec.tsx
```

Elvárt: PASS, mind a 19 eset.
- Ha a `data:` eset azért zöld, mert a parser nem is linknek ismerte fel, az is elfogadható, mert a feltétel így is az, hogy nincs `<a`.
- Ha bármelyik link-eset váratlanul `<a href="">`-t ad, az `a` komponens `href ?` ága a hibás.

- [ ] **6. lépés: a `message-parts.spec.tsx` bővítése** (bukó tesztek)

A `describe('MessageParts')` blokk végére:

```tsx
  it('should keep a user message as plain pre-wrap text when it contains Markdown or HTML', () => {
    const html = render({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: '**félkövér** <b>x</b>' }],
    });

    expect(html).toMatch(/<p class="_text_[^"]*">/);
    expect(html).toContain('**félkövér** &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<strong>');
  });

  it('should render the answer as Markdown when the message is from the assistant', () => {
    const html = render({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'A **Monstera** jó választás.' }],
    });

    expect(html).toMatch(/class="_markdown_/);
    expect(html).toContain('<strong>Monstera</strong>');
  });

  it('should show the badge and the formatted answer when an escalated answer uses Markdown', () => {
    const html = render({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: '[ESCALATE] Egy **kollégánk** jelentkezik.' }],
    });

    expect(html).toContain('Kollégának továbbítva');
    expect(html).toContain('<strong>kollégánk</strong>');
    expect(html).not.toContain('[ESCALATE]');
  });
```

- [ ] **7. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/chat/message-parts.spec.tsx
```

Elvárt: FAIL. A „render the answer as Markdown” és az „escalated … Markdown” eset bukik: nincs `<strong>`.

- [ ] **8. lépés: a `message-parts.tsx` bekötése**

Új import:

```tsx
import { AssistantMarkdown } from './assistant-markdown';
```

Az asszisztens-ág `<p className={styles.text}>{text}</p>` sora erre változik:

```tsx
          <AssistantMarkdown text={text} />
```

- [ ] **9. lépés: a web teljes tesztkészletének futtatása**

```bash
pnpm nx run-many -t lint,typecheck,test -p web
```

Elvárt: PASS. 37 meglévő + 19 új (`assistant-markdown`) + 3 új (`message-parts`).

- [ ] **10. lépés: commit**

```bash
git add apps/web/src/chat/assistant-markdown.tsx apps/web/src/chat/assistant-markdown.spec.tsx apps/web/src/chat/message-parts.tsx apps/web/src/chat/message-parts.spec.tsx apps/web/src/chat/chat.module.css
git commit -m "feat(web): render assistant answers as safe Markdown" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 4. task: félkész Markdown streamelés közben (`feat(web): close unfinished Markdown while an answer streams`)

**Fájlok:**
- Módosul: `apps/web/src/chat/assistant-markdown.tsx` (új `isStreaming` prop, remend)
- Módosul: `apps/web/src/chat/assistant-markdown.spec.tsx`
- Módosul: `apps/web/src/chat/message-parts.tsx` (új `isStreaming` prop)
- Módosul: `apps/web/src/chat/message-parts.spec.tsx`
- Módosul: `apps/web/src/chat/chat-panel.tsx`
- Módosul: `apps/web/src/chat/chat-panel.spec.tsx`

**Interfészek:**
- Felhasznál: a 3. task `AssistantMarkdown`-ját.
- Termel:
  - `AssistantMarkdownProps { text: string; isStreaming: boolean }`;
  - `MessagePartsProps { message: ChatMessage; escalatePrefix: string; isStreaming: boolean }`. Az `isStreaming` kötelező, így a fordító minden hívót megtalál.

- [ ] **1. lépés: a remend tényleges viselkedésének ellenőrzése** (a tesztek alapja, csak olvasás)

```bash
cd apps/web && node --input-type=module -e "import r from 'remend'; for (const s of ['ár: **nyitott', '\`\`\`sql\nSELECT 1', '[kattints](https://pel', 'ár: **zárt**']) console.log(JSON.stringify(r(s)))"
```

Elvárt:
- `"ár: **nyitott**"`;
- egy lezárt kódblokk;
- `"[kattints](streamdown:incomplete-link)"`;
- `"ár: **zárt**"` változatlanul.

Ha a félkész linkből más lesz, a link-teszt elvárása marad („nincs `<a`, a szöveg látszik”), mert a `safeUrl` minden nem http(s)/mailto URL-t eldob.

- [ ] **2. lépés: a bukó tesztek megírása az `assistant-markdown.spec.tsx`-ben**

A `render` helper erre változik:

```tsx
function render(text: string, isStreaming = false): string {
  return renderToStaticMarkup(
    <AssistantMarkdown text={text} isStreaming={isStreaming} />,
  );
}
```

Új `describe` blokk:

```tsx
  describe('unfinished Markdown', () => {
    it('should close an open bold mark when the answer is streaming', () => {
      expect(render('ár: **nyitott', true)).toContain('<strong>nyitott</strong>');
    });

    it('should close an open code fence when the answer is streaming', () => {
      expect(render('```sql\nSELECT 1', true)).toMatch(/<pre><code[^>]*>SELECT 1/);
    });

    it('should show an unfinished link as text when the answer is streaming', () => {
      const html = render('Lásd [kattints](https://pel', true);

      expect(html).not.toContain('<a');
      expect(html).toContain('kattints');
    });

    it('should leave a finished answer untouched when it is not streaming', () => {
      const html = render('ár: **nyitott', false);

      expect(html).toContain('ár: **nyitott');
      expect(html).not.toContain('<strong>');
    });

    it('should render nothing visible when a streaming answer is still empty', () => {
      expect(render('', true)).toMatch(/^<div class="_markdown_[^"]*"><\/div>$/);
    });
  });
```

- [ ] **3. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/chat/assistant-markdown.spec.tsx
```

Elvárt:
- FAIL a „close an open bold”, a „close an open code fence” és az „unfinished link” esetén. Ezeknél nincs remend, és a nyers `[kattints](https://pel` nem link, ezért ez utóbbi akár zöld is lehet.
- A typecheck jelezné az ismeretlen `isStreaming` propot.

- [ ] **4. lépés: implementáció az `assistant-markdown.tsx`-ben**

Új import:

```tsx
import remend from 'remend';
```

A props és a komponens:

```tsx
export interface AssistantMarkdownProps {
  text: string;
  /** True only for the answer still arriving: closes unfinished marks. */
  isStreaming: boolean;
}

/**
 * The assistant's answer as Markdown. Memoized: while one answer streams,
 * the whole list re-renders on every chunk, but finished answers keep the
 * same props and are not parsed again.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  isStreaming,
}: AssistantMarkdownProps) {
  // remend only papers over a half-received chunk; a finished answer is
  // shown exactly as the model wrote it.
  const markdown = isStreaming ? remend(text) : text;

  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        urlTransform={safeUrl}
        components={COMPONENTS}
      >
        {markdown}
      </Markdown>
    </div>
  );
});
```

- [ ] **5. lépés: a `message-parts.spec.tsx` bővítése** (bukó tesztek)

A `render` helper erre változik:

```tsx
function render(message: ChatMessage, isStreaming = false): string {
  return renderToStaticMarkup(
    <MessageParts
      message={message}
      escalatePrefix={ESCALATE_PREFIX}
      isStreaming={isStreaming}
    />,
  );
}
```

Új eset:

```tsx
  it('should close unfinished Markdown only in the last text part when the message streams', () => {
    const html = render(
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Előbb: **első' },
          {
            type: 'tool-runSql',
            toolCallId: 't1',
            state: 'input-available',
            input: { sql: 'SELECT 1' },
          },
          { type: 'text', text: 'Aztán: **második' },
        ],
      },
      true,
    );

    expect(html).toContain('Előbb: **első');
    expect(html).toContain('<strong>második</strong>');
  });
```

- [ ] **6. lépés: a `message-parts.tsx` implementációja**

A props:

```tsx
export interface MessagePartsProps {
  message: ChatMessage;
  escalatePrefix: string;
  /** True while this message is the answer still arriving. */
  isStreaming: boolean;
}
```

A komponens eleje:

```tsx
export function MessageParts({
  message,
  escalatePrefix,
  isStreaming,
}: MessagePartsProps) {
  // Only the last text part can still be arriving; earlier parts are done.
  const streamingTextIndex = isStreaming
    ? message.parts.findLastIndex((part) => part.type === 'text')
    : -1;

  return message.parts.map((part, index) => {
```

Az asszisztens-ágban:

```tsx
          <AssistantMarkdown
            text={text}
            isStreaming={index === streamingTextIndex}
          />
```

- [ ] **7. lépés: a `chat-panel.spec.tsx` bővítése** (bukó teszt)

```tsx
  it('should close unfinished Markdown only in the last answer when the answer streams', () => {
    const html = renderWith({
      status: 'streaming',
      messages: [
        { id: 'a0', role: 'assistant', parts: [{ type: 'text', text: 'Régi: **nyitott' }] },
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'És még?' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Új: **nyitott' }] },
      ],
    });

    expect(html).toContain('Régi: **nyitott');
    expect(html).toContain('Új: <strong>nyitott</strong>');
  });

  it('should leave the last answer untouched when the stream has stopped', () => {
    const html = renderWith({
      status: 'ready',
      messages: [
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Félbe: **nyitott' }] },
      ],
    });

    expect(html).toContain('Félbe: **nyitott');
  });
```

- [ ] **8. lépés: a `chat-panel.tsx` implementációja**

A `messages.map` erre változik:

```tsx
        {messages.map((message, index) => (
          <li
            key={message.id}
            className={message.role === 'user' ? styles.user : styles.assistant}
          >
            <MessageParts
              message={message}
              escalatePrefix={escalatePrefix}
              isStreaming={
                status === 'streaming' &&
                message.role === 'assistant' &&
                index === messages.length - 1
              }
            />
          </li>
        ))}
```

- [ ] **9. lépés: a web teljes tesztkészletének futtatása**

```bash
pnpm nx run-many -t lint,typecheck,test -p web
```

Elvárt: PASS. +5 `assistant-markdown`, +1 `message-parts`, +2 `chat-panel` teszt.

- [ ] **10. lépés: commit**

```bash
git add apps/web/src/chat/assistant-markdown.tsx apps/web/src/chat/assistant-markdown.spec.tsx apps/web/src/chat/message-parts.tsx apps/web/src/chat/message-parts.spec.tsx apps/web/src/chat/chat-panel.tsx apps/web/src/chat/chat-panel.spec.tsx
git commit -m "feat(web): close unfinished Markdown while an answer streams" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 5. task: dokumentáció és végellenőrzés (`docs: describe Markdown rendering in CLAUDE.md`)

**Fájlok:**
- Módosul: `CLAUDE.md` (az `apps/web` bullet, az `Az src/chat/ a UI: …` mondat után)

- [ ] **1. lépés: a `CLAUDE.md` kiegészítése**

A „…ezért a `tool-step-view.ts` azt is hibaként jelzi.” mondat után:

```markdown
Az asszisztens szövegét az `assistant-markdown.tsx` rendereli Markdownként (`react-markdown` + `remark-gfm`, pontos verziókon), a modell kimenetét nem megbízható bemenetként kezelve: nyers HTML nincs (`skipHtml`, `rehype-raw` soha), kép nincs (adatszivárgási csatorna), link csak `http(s)`/`mailto` engedélylistával, `target="_blank" rel="noopener noreferrer nofollow"`-val; streamelés közben a `remend` zárja le a félkész jeleket, a kész választ nem érinti. A felhasználó üzenete sima szöveg marad.
```

- [ ] **2. lépés: commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe Markdown rendering in CLAUDE.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **3. lépés: automata végellenőrzés**

```bash
pnpm nx run-many -t lint,typecheck,test -p core web cli --skip-nx-cache
pnpm nx build web
git diff --stat main
```

Elvárt:
- minden zöld;
- a `next build` sikeres, és csak az ismert „Critical dependency” figyelmeztetést adja;
- a diffben nincs `apps/customer-chat`, `packages/`, `docs/system-prompt.md` és `pnpm-workspace.yaml`.

- [ ] **4. lépés: kézi próba a böngészőben** (`pnpm nx dev web`, http://localhost:3001; desktop, és a DevTools-ban 375 px széles nézet)

1. „Hasonlítsd össze a 3 legolcsóbb kaktuszt”: a táblázat megjelenik, és 375 px-en a buborékon belül vízszintesen görgethető. Az oldal nem görget vízszintesen.
2. „Sorold fel a Monstera deliciosa gondozási tulajdonságait”: megnézni, hogy a sorok külön sorban vannak-e, vagy összefolynak. Ha összefolynak, **ne javítsd**, hanem jelezd: ez a spec 9.1 és 9.2 nyitott kérdése.
3. A Markdown-elemek között nincs plusz üres sor. (A user-üzenet `pre-wrap`-jét az automata teszt fedi: a beviteli mező `<input>`, egysoros, így többsoros user-üzenet a felületen nem is küldhető.)
4. Streamelés közben nem villognak nyers `**` vagy ```` ``` ```` jelek.
5. Leállítás streamelés közben: a félbehagyott válasz összeomlás nélkül, a nyers tartalmával látszik.
6. Ha a válaszban van link (pl. tudásbázis-forrás), az új lapon nyílik, és a DevTools-ban `rel="noopener noreferrer nofollow"` látszik.
7. Sötét mód (`prefers-color-scheme: dark` emuláció): a kód és a táblázat olvasható.

- [ ] **5. lépés: záró riport a felhasználónak**
  - commitonként a `git diff --stat`;
  - a lint, typecheck és test eredménye;
  - a `next build` eredménye;
  - a kézi próba pontonként.

  **Push, PR és merge csak a kifejezett jóváhagyása után.**
