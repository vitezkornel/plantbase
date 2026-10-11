# Rögzített beviteli sáv és okos görgetés — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cél:** az `apps/web` chat beviteli sávja az ablak alján üljön, rövid beszélgetésnél is, azonos méretű gombokkal. Az automatikus görgetés csak akkor kövesse a streamelt választ, ha az olvasó alul van; felgörgetéskor jelenjen meg egy „Ugrás az aljára” gomb; mobilon a sáv maradjon látható.

**Architektúra:**
- Az oldal görget.
- A fő oszlop legalább `100dvh` magas flex oszlop, a sáv (`.composer`) `margin-top: auto` + `position: sticky; bottom: 0`.
- A görgetési döntések tiszta függvények egy új `scroll-follow.ts`-ben.
- Egy vékony kliensoldali hook (`use-follow-bottom.ts`) köti őket az ablak `scroll`/`resize` eseményeihez és az új tartalomhoz.

**Tech stack:** Next.js 16 (webpack, App Router `viewport` export), React 19.3 (`useLayoutEffect`), CSS-modulok, Vitest (node, `renderToStaticMarkup`). Új függőség nincs.

**Spec:** `docs/superpowers/specs/2026-10-11-web-chat-layout-design.md`

## Globális megkötések

- Csak az `apps/web` változik (és a 6. taskban a `CLAUDE.md`). A `core`, a system prompt és az `apps/customer-chat` **nem**.
- Nincs új függőség, nincs jsdom, nincs Testing Library.
- A görgetési tűrés `NEAR_BOTTOM_PX = 48`. Minden programozott görgetés `behavior: 'instant'`.
- A gombok `min-width: 7.5rem`, az input `font-size: 16px`.
- A `viewport` export értékei: `width: 'device-width'`, `initialScale: 1`, `viewportFit: 'cover'`, `interactiveWidget: 'resizes-content'`.
- A `↓` gomb `aria-label`-je „Ugrás az aljára”. Abszolút pozicionált, nem változtat a sáv magasságán.
- Tesztek:
  - a nevük „should … when …” alakú;
  - a CSS-modul osztálynevek a Vitestben `_<név>_<hash>` alakúak, ezért a tesztek így illesztenek: `/class="_composer_/`.
- Minden commit végén: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push, PR és merge csak kifejezett jóváhagyással.
- A prettier ne formázzon újra független sorokat. Ezt a `main`-en is tiszta fájlok esetén ellenőrizni kell.

## Review fókusz

Öt hibamód, amit a spec sugall, de az SSR- és unit-tesztek nem érnek el. Ezeket a kézi próba (7. task, 3. lépés) és a reviewer külön nézi:

1. **A hook kiveszi a figyelőit unmountkor:** a `useEffect` cleanup mindkét `removeEventListener`-t hívja, ugyanazzal a függvény-referenciával.
2. **Az első renderkor nincs ugrás:** a kezdeti `isFollowing: true` miatt az üres lista mellett a `useLayoutEffect` az aljára ugrik, ami ártalmatlan. A fejléc viszont látható marad, mert a tartalom rövidebb a képernyőnél.
3. **A `Gondolkodom…` sor eltűnése** (zsugorodó tartalom) nem kapcsolja ki a követést. Ezt a `nextFollowState` unit-tesztje fedi, a valós böngésző-viselkedést a kézi próba 8. és 9. pontja.
4. **A sticky sáv háttere** takarja a mögötte elfutó üzeneteket. Ha átlátszó lenne, a szöveg átütne rajta.
5. **A `↓` gomb billentyűzettel elérhető** (valódi `<button>`, `aria-label`), és nem takarja el a Küldés/Leállítás gombot 375 px-en.

---

### 1. task: spec és terv (`docs: add the web chat layout design spec and plan`)

**Fájlok:**
- Új: `docs/superpowers/specs/2026-10-11-web-chat-layout-design.md`
- Új: `docs/superpowers/plans/2026-10-11-web-chat-layout.md`

- [ ] **1. lépés: commit**

```bash
git add docs/superpowers/specs/2026-10-11-web-chat-layout-design.md docs/superpowers/plans/2026-10-11-web-chat-layout.md
git commit -m "docs: add the web chat layout design spec and plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 2. task: a sáv az ablak alján (`feat(web): pin the composer to the bottom of the window`)

**Fájlok:**
- Módosul: `apps/web/src/chat/chat-panel.tsx`, ahol a hiba és a form egy új `.composer` div-be kerül
- Módosul: `apps/web/src/chat/chat.module.css`, ahol változik a `.panel` és a `.button`, és új a `.composer`
- Módosul: `apps/web/src/app/page.module.css` (`.main`)
- Módosul: `apps/web/src/chat/chat-panel.spec.tsx`

**Interfészek:**
- Termel: a `.composer` CSS-osztály és a DOM-sorrend: `<ol>` → `.composer` (benne `role="alert"` → `<form>`).
- Az 5. task a `.composer`-be, a hiba elé teszi a `↓` gombot.

- [ ] **1. lépés: a bukó tesztek megírása** (a `chat-panel.spec.tsx` `describe` blokkjának végére)

```tsx
  it('should keep the error and the form together in the composer below the messages', () => {
    const html = renderWith({
      status: 'error',
      error: new Error('Hiba történt a válasz közben.'),
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Szia!' }] },
      ],
    });

    const list = html.indexOf('<ol');
    const composer = html.search(/<div class="_composer_/);
    const alert = html.indexOf('role="alert"');
    const form = html.indexOf('<form');

    expect(composer).toBeGreaterThan(list);
    expect(alert).toBeGreaterThan(composer);
    expect(form).toBeGreaterThan(alert);
  });

  it('should give the send and the stop button the same sizing class when they swap', () => {
    const buttonClass = (html: string) =>
      html.match(/<button[^>]*class="(_button_[^"]*)"/)?.[1];

    const ready = buttonClass(renderWith({ status: 'ready' }));
    const streaming = buttonClass(renderWith({ status: 'streaming' }));

    expect(ready).toMatch(/^_button_/);
    expect(streaming).toBe(ready);
  });
```

- [ ] **2. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/chat/chat-panel.spec.tsx
```

Elvárt:
- FAIL a „composer” esetben: a `composer` értéke −1.
- A gombos eset már most zöld lehet, mert a két gomb ma is a `.button` osztályt kapja. Ez regressziós őr: a vízszintes javítás maga a CSS `min-width`, amit a kézi próba ellenőriz. Ezt a ledgerbe is fel kell jegyezni.

- [ ] **3. lépés: implementáció a `chat-panel.tsx`-ben**

A `{error && …}` blokk és a `<form>…</form>` közös wrapperbe kerül, a `</ol>` után:

```tsx
      <div className={styles.composer}>
        {error && (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          {/* …a meglévő input és gombok változatlanul… */}
        </form>
      </div>
```

- [ ] **4. lépés: CSS a `chat.module.css`-ben**

A `.panel` erre változik:

```css
.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

A `.form` szabály elé:

```css
/* Pinned to the bottom of the window: margin-top: auto for a short chat,
   sticky for a long one. Opaque, so messages scroll behind it. */
.composer {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0 max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--bg);
}
```

A `.button` szabályba (a `Küldés` és a `Leállítás` ugyanazt kapja, így a csere nem mozdít semmit):

```css
  min-width: 7.5rem;
```

- [ ] **5. lépés: a fő oszlop a `page.module.css`-ben**

```css
.main {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: 760px;
  margin: 0 auto;
  padding: 32px max(16px, env(safe-area-inset-right)) 0
    max(16px, env(safe-area-inset-left));
}
```

- [ ] **6. lépés: a web teljes tesztkészlete, a lint és a typecheck**

```bash
pnpm nx run-many -t lint,typecheck,test -p web
```

Elvárt: PASS, 68 + 2 = 70 teszt.

- [ ] **7. lépés: commit**

```bash
git add apps/web/src/chat/chat-panel.tsx apps/web/src/chat/chat-panel.spec.tsx apps/web/src/chat/chat.module.css apps/web/src/app/page.module.css
git commit -m "feat(web): pin the composer to the bottom of the window" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 3. task: mobil (`feat(web): tune the chat for mobile`)

**Fájlok:**
- Módosul: `apps/web/src/app/layout.tsx` (új `viewport` export)
- Új: `apps/web/src/app/layout.spec.ts`
- Módosul: `apps/web/src/chat/chat.module.css` (`.input`)

**Interfészek:**
- Termel: `export const viewport: Viewport` a `layout.tsx`-ből.

- [ ] **1. lépés: a bukó teszt megírása:** `apps/web/src/app/layout.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { viewport } from './layout';

describe('viewport', () => {
  it('should resize the content and cover the safe areas when a mobile keyboard opens', () => {
    expect(viewport).toEqual({
      width: 'device-width',
      initialScale: 1,
      viewportFit: 'cover',
      interactiveWidget: 'resizes-content',
    });
  });
});
```

- [ ] **2. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/app/layout.spec.ts
```

Elvárt: FAIL, mert a `viewport` `undefined`.

- [ ] **3. lépés: implementáció a `layout.tsx`-ben**

Az import erre változik:

```tsx
import type { Metadata, Viewport } from 'next';
```

A `metadata` után:

```tsx
// resizes-content: on Android the keyboard shrinks the layout, so the
// composer pinned to the bottom stays visible (iOS Safari ignores it and
// scrolls the focused input into view itself). cover: makes the
// env(safe-area-inset-*) values non-zero for the iPhone home indicator.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};
```

- [ ] **4. lépés: az input betűmérete a `chat.module.css`-ben**

A `.input` szabályban a `font: inherit;` sor után:

```css
  /* Below 16px iOS Safari zooms into the page when the input is focused. */
  font-size: 16px;
```

- [ ] **5. lépés: a web teljes tesztkészlete, a lint és a typecheck**

```bash
pnpm nx run-many -t lint,typecheck,test -p web
```

Elvárt: PASS, 71 teszt.

- [ ] **6. lépés: commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/app/layout.spec.ts apps/web/src/chat/chat.module.css
git commit -m "feat(web): tune the chat for mobile" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 4. task: okos követés (`feat(web): follow the streamed answer only while the reader is at the bottom`)

**Fájlok:**
- Új: `apps/web/src/chat/scroll-follow.ts`
- Új: `apps/web/src/chat/scroll-follow.spec.ts`
- Új: `apps/web/src/chat/use-follow-bottom.ts`
- Módosul: `apps/web/src/chat/chat-panel.tsx` (a hook és a `handleSubmit`)

**Interfészek:**
- Termel, és az 5. task bővíti:
  - `ScrollMetrics`, `FollowState`, `NEAR_BOTTOM_PX`;
  - `isNearBottom(metrics, threshold?)`;
  - `nextFollowState(prev, metrics)`;
  - `useFollowBottom(content: unknown): { isFollowing: boolean; scrollToBottom: () => void }`.

- [ ] **1. lépés: a bukó tesztek megírása:** `apps/web/src/chat/scroll-follow.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  isNearBottom,
  NEAR_BOTTOM_PX,
  nextFollowState,
  type ScrollMetrics,
} from './scroll-follow';

// A 1000 px tall page in a 600 px tall window: the bottom is scrollTop 400.
function at(scrollTop: number, scrollHeight = 1000): ScrollMetrics {
  return { scrollTop, scrollHeight, clientHeight: 600 };
}

describe('isNearBottom', () => {
  it('should be true when the view is exactly at the bottom', () => {
    expect(isNearBottom(at(400))).toBe(true);
  });

  it('should be true when the view is within the tolerance', () => {
    expect(isNearBottom(at(400 - (NEAR_BOTTOM_PX - 1)))).toBe(true);
  });

  it('should be true when the view is exactly at the tolerance', () => {
    expect(isNearBottom(at(400 - NEAR_BOTTOM_PX))).toBe(true);
  });

  it('should be false when the view is one pixel beyond the tolerance', () => {
    expect(isNearBottom(at(400 - NEAR_BOTTOM_PX - 1))).toBe(false);
  });

  it('should be true when the content is shorter than the window', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 600 })).toBe(true);
  });

  it('should be true when a zoomed page reports a fractional scrollTop at the bottom', () => {
    expect(isNearBottom(at(399.6))).toBe(true);
  });

  it('should use the given threshold when one is passed', () => {
    expect(isNearBottom(at(390), 5)).toBe(false);
    expect(isNearBottom(at(396), 5)).toBe(true);
  });
});

describe('nextFollowState', () => {
  const following = { isFollowing: true, lastScrollTop: 400 };
  const reading = { isFollowing: false, lastScrollTop: 100 };

  it('should keep following when the content grows below a view that did not move', () => {
    expect(nextFollowState(following, at(400, 1600)).isFollowing).toBe(true);
  });

  it('should keep following when the view moves down but not to the bottom', () => {
    expect(nextFollowState(following, at(500, 1600)).isFollowing).toBe(true);
  });

  it('should stop following when the reader scrolls up beyond the tolerance', () => {
    expect(nextFollowState(following, at(200)).isFollowing).toBe(false);
  });

  it('should keep following when the reader scrolls up within the tolerance', () => {
    expect(nextFollowState(following, at(380)).isFollowing).toBe(true);
  });

  it('should keep following when shrinking content pulls the view up but it stays at the bottom', () => {
    // The "Gondolkodom…" row or an error disappears: the page loses 40 px and
    // the browser clamps scrollTop from 400 to 360 — still the bottom.
    expect(nextFollowState(following, at(360, 960)).isFollowing).toBe(true);
  });

  it('should stay put when a reader who left the bottom scrolls down but not to it', () => {
    expect(nextFollowState(reading, at(250)).isFollowing).toBe(false);
  });

  it('should follow again when a reader who left the bottom scrolls back to it', () => {
    expect(nextFollowState(reading, at(400)).isFollowing).toBe(true);
  });

  it('should remember the new scroll position when any scroll event arrives', () => {
    expect(nextFollowState(reading, at(250)).lastScrollTop).toBe(250);
    expect(nextFollowState(following, at(360, 960)).lastScrollTop).toBe(360);
  });
});
```

- [ ] **2. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/chat/scroll-follow.spec.ts
```

Elvárt: FAIL, „Cannot find module './scroll-follow'”.

- [ ] **3. lépés: implementáció:** `apps/web/src/chat/scroll-follow.ts`

```ts
// The chat's scroll decisions, kept free of React and the DOM so they can
// be unit-tested: the browser's real scrolling is out of reach of the SSR
// tests (and jsdom computes no layout).

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface FollowState {
  isFollowing: boolean;
  lastScrollTop: number;
}

// Tolerance so a tiny nudge or a fractional scrollTop (zoom, HiDPI) still
// counts as "at the bottom".
export const NEAR_BOTTOM_PX = 48;

/** True when the bottom of the view is within `threshold` px of the content's bottom. */
export function isNearBottom(
  metrics: ScrollMetrics,
  threshold = NEAR_BOTTOM_PX,
): boolean {
  const { scrollTop, scrollHeight, clientHeight } = metrics;
  return scrollHeight - clientHeight - scrollTop <= threshold;
}

/**
 * One scroll event. Only the reader scrolling up stops the following:
 * growing content never lowers scrollTop, so a scroll event that fires
 * while a large chunk arrives cannot switch it off by itself; and content
 * that shrinks while the view stays at the bottom keeps it on.
 */
export function nextFollowState(
  prev: FollowState,
  metrics: ScrollMetrics,
): FollowState {
  const scrolledUp = metrics.scrollTop < prev.lastScrollTop;
  return {
    isFollowing: isNearBottom(metrics) || (prev.isFollowing && !scrolledUp),
    lastScrollTop: metrics.scrollTop,
  };
}
```

- [ ] **4. lépés: futtatás, sikeresnek kell lennie**

```bash
pnpm nx test web -- src/chat/scroll-follow.spec.ts
```

Elvárt: PASS, 15 teszt.

- [ ] **5. lépés: a hook:** `apps/web/src/chat/use-follow-bottom.ts`

Ezt az SSR nem futtatja, mert az effektek ott nem futnak le, és jsdom nincs. Az ellenőrzése a typecheck és a kézi próba.

```ts
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nextFollowState, type FollowState, type ScrollMetrics } from './scroll-follow';

function scrollingElement(): Element {
  return document.scrollingElement ?? document.documentElement;
}

function readMetrics(): ScrollMetrics {
  const { scrollTop, scrollHeight, clientHeight } = scrollingElement();
  return { scrollTop, scrollHeight, clientHeight };
}

// Instant on purpose: a smooth scroll lags behind a streaming answer.
function jumpToBottom(): void {
  window.scrollTo({ top: scrollingElement().scrollHeight, behavior: 'instant' });
}

/**
 * Keeps the window at the bottom while `content` (the message list) grows —
 * but only while the reader is following; scrolling up stops it, scrolling
 * back down or `scrollToBottom()` resumes it. The decisions live in
 * scroll-follow.ts; this hook only wires them to the window.
 */
export function useFollowBottom(content: unknown): {
  isFollowing: boolean;
  scrollToBottom: () => void;
} {
  const stateRef = useRef<FollowState>({ isFollowing: true, lastScrollTop: 0 });
  const [isFollowing, setIsFollowing] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      stateRef.current = nextFollowState(stateRef.current, readMetrics());
      setIsFollowing(stateRef.current.isFollowing);
    };
    // E.g. an Android keyboard shrinking the layout (interactive-widget).
    const handleResize = () => {
      if (stateRef.current.isFollowing) {
        jumpToBottom();
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Before paint, so a new chunk never flashes below the composer.
  useLayoutEffect(() => {
    if (stateRef.current.isFollowing) {
      jumpToBottom();
    }
  }, [content]);

  const scrollToBottom = useCallback(() => {
    stateRef.current = { ...stateRef.current, isFollowing: true };
    setIsFollowing(true);
    jumpToBottom();
  }, []);

  return { isFollowing, scrollToBottom };
}
```

- [ ] **6. lépés: bekötés a `chat-panel.tsx`-be**

Új import:

```tsx
import { useFollowBottom } from './use-follow-bottom';
```

A `useChat` hívás után:

```tsx
  const { scrollToBottom } = useFollowBottom(messages);
```

A `handleSubmit`-ben a `void sendMessage({ text });` sor elé:

```tsx
    // Sending means "show me the answer": follow it even if scrolled up.
    scrollToBottom();
```

Az `isFollowing` itt még nincs destruktúrálva. Az 5. task használja, így addig nincs nem használt változó.

- [ ] **7. lépés: a web teljes tesztkészlete, a lint és a typecheck**

```bash
pnpm nx run-many -t lint,typecheck,test -p web
```

Elvárt:
- PASS, 71 + 15 = 86 teszt;
- a meglévő `chat-panel` SSR-tesztek változatlanul zöldek, mert az SSR nem futtat effektet, és a `useLayoutEffect` a React 19-ben nem figyelmeztet szerveroldalon.

- [ ] **8. lépés: commit**

```bash
git add apps/web/src/chat/scroll-follow.ts apps/web/src/chat/scroll-follow.spec.ts apps/web/src/chat/use-follow-bottom.ts apps/web/src/chat/chat-panel.tsx
git commit -m "feat(web): follow the streamed answer only while the reader is at the bottom" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 5. task: „Ugrás az aljára” gomb (`feat(web): add a jump-to-bottom button`)

**Fájlok:**
- Módosul: `apps/web/src/chat/scroll-follow.ts` és a specje
- Módosul: `apps/web/src/chat/chat-panel.tsx`
- Módosul: `apps/web/src/chat/chat.module.css` (új `.composer` `position` kontextus és `.jumpToBottom`)
- Módosul: `apps/web/src/chat/chat-panel.spec.tsx`

**Interfészek:**
- Felhasznál: a 4. task `useFollowBottom`-ját.
- Termel: `shouldShowJumpButton(isFollowing: boolean, messageCount: number): boolean`.

- [ ] **1. lépés: a bukó tesztek a `scroll-follow.spec.ts`-ben**

Az importba a `shouldShowJumpButton` is bekerül. A fájl végére:

```ts
describe('shouldShowJumpButton', () => {
  it('should hide the button when the reader is following', () => {
    expect(shouldShowJumpButton(true, 3)).toBe(false);
  });

  it('should show the button when the reader has left the bottom of a conversation', () => {
    expect(shouldShowJumpButton(false, 3)).toBe(true);
  });

  it('should hide the button when there are no messages yet', () => {
    expect(shouldShowJumpButton(false, 0)).toBe(false);
  });
});
```

A `chat-panel.spec.tsx` végére:

```tsx
  it('should not offer the jump-to-bottom button when the reader is following', () => {
    const html = renderWith({
      status: 'streaming',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Szia!' }] },
      ],
    });

    expect(html).not.toContain('Ugrás az aljára');
  });
```

- [ ] **2. lépés: futtatás, és ellenőrizni, hogy bukik**

```bash
pnpm nx test web -- src/chat/scroll-follow.spec.ts src/chat/chat-panel.spec.tsx
```

Elvárt:
- FAIL: a `shouldShowJumpButton` nem függvény;
- a `chat-panel` gombteszt már most zöld, mert gomb még nincs. Ez őr arra, hogy követés közben ne jelenjen meg.

- [ ] **3. lépés: implementáció a `scroll-follow.ts`-ben** (a fájl végére)

```ts
/** The ↓ button shows when the reader has left the bottom and there is something to return to. */
export function shouldShowJumpButton(
  isFollowing: boolean,
  messageCount: number,
): boolean {
  return !isFollowing && messageCount > 0;
}
```

- [ ] **4. lépés: a gomb a `chat-panel.tsx`-ben**

Az import erre változik:

```tsx
import { shouldShowJumpButton } from './scroll-follow';
```

A hook-hívás erre:

```tsx
  const { isFollowing, scrollToBottom } = useFollowBottom(messages);
```

A `.composer` div első gyereke:

```tsx
        {shouldShowJumpButton(isFollowing, messages.length) && (
          <button
            type="button"
            className={styles.jumpToBottom}
            aria-label="Ugrás az aljára"
            onClick={scrollToBottom}
          >
            ↓
          </button>
        )}
```

- [ ] **5. lépés: CSS a `chat.module.css`-ben** (a `.composer` szabály után)

```css
/* Floats above the composer (the sticky composer is its containing block),
   so showing it never changes the composer's height. */
.jumpToBottom {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 6px rgb(0 0 0 / 15%);
}
```

- [ ] **6. lépés: a web teljes tesztkészlete, a lint és a typecheck**

```bash
pnpm nx run-many -t lint,typecheck,test -p web
```

Elvárt: PASS, 86 + 3 + 1 = 90 teszt.

- [ ] **7. lépés: commit**

```bash
git add apps/web/src/chat/scroll-follow.ts apps/web/src/chat/scroll-follow.spec.ts apps/web/src/chat/chat-panel.tsx apps/web/src/chat/chat-panel.spec.tsx apps/web/src/chat/chat.module.css
git commit -m "feat(web): add a jump-to-bottom button" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 6. task: dokumentáció (`docs: describe the chat layout in CLAUDE.md`)

**Fájlok:**
- Módosul: `CLAUDE.md` (az `apps/web` bullet, a Markdown-mondatok után)

- [ ] **1. lépés: kiegészítés**

A „…A felhasználó üzenete sima szöveg marad.” mondat után:

```markdown
A beviteli sáv (`.composer`) az ablak alján ül (a `main` `min-height: 100dvh` flex oszlop, a sáv `margin-top: auto` + `position: sticky`), azonos szélességű Küldés/Leállítás gombbal; az automatikus görgetés csak akkor követi a streamelt választ, ha az olvasó alul van (a döntések tiszta függvények a `scroll-follow.ts`-ben, a `use-follow-bottom.ts` csak az ablakhoz köti őket), felgörgetéskor „Ugrás az aljára” gomb jelenik meg, küldéskor a nézet az aljára ugrik. Mobilra a `layout.tsx` `viewport` exportja `interactiveWidget: 'resizes-content'`-et és `viewportFit: 'cover'`-t ad.
```

- [ ] **2. lépés: commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe the chat layout in CLAUDE.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 7. task: végellenőrzés (commit nélkül)

- [ ] **1. lépés: automata ellenőrzés**

```bash
pnpm nx run-many -t lint,typecheck,test -p core web cli --skip-nx-cache
pnpm nx build web
git diff --stat main
```

Elvárt:
- minden zöld;
- a `next build` csak az ismert „Critical dependency” figyelmeztetést adja;
- a diffben nincs `apps/customer-chat`, `packages/` és `pnpm-lock.yaml`.

- [ ] **2. lépés: független reviewer**

A legerősebb modellen, az egész ágra. Kapja meg a spec-et, a tervet, a Review fókusz listát és a ledger döntéseit.

- [ ] **3. lépés: kézi próba**

A spec 6.3 pontjának 13 lépése: desktop, DevTools 375 px, sötét mód. A valós mobil billentyűzetet a DevTools nem emulálja, ezt a riport külön jelzi.

- [ ] **4. lépés: záró riport**
  - commitonként a `git diff --stat`;
  - a lint, typecheck, test és build eredménye;
  - a reviewer eredménye;
  - a döntések;
  - a kézi próba.

  **Push, PR és merge csak kifejezett jóváhagyással.**
