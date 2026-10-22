# Hang-funkció 1. szakasz (cascade) — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cél:** új `/voice` oldal az `apps/web`-ben: nyomva tartott gomb (és szóköz) → STT → a meglévő ask-agent (`voice` módban) → mondatonkénti TTS, filler mondatokkal, kézi barge-in-nel és waterfall panellel.

**Architektúra:**
- Egy `POST /api/voice` (multipart be, NDJSON-folyam ki) fut végig a STT → `streamAskAgent` → mondatbontás → TTS láncon; egyetlen fetch, így a barge-in egyetlen `AbortController`.
- A core-ba egyetlen nem törő opció kerül (`mode: 'text' | 'voice'`) és a `VOICE_PROMPT_SECTION` konstans.
- A kliens tiszta függvényekre (parser, reducer, állapotgép, hangsor) épül, vékony React-réteggel; a repó módszere: node-környezet, SSR + unit, nincs jsdom.

**Tech stack:** Next.js 16 (webpack), React 19.3, Vercel AI SDK (`ai@5.0.261`: `experimental_transcribe`, `experimental_generateSpeech`), `@ai-sdk/openai@2.0.135` (új, pontos verzió), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-web-voice-cascade-design.md`

## Global Constraints

- Ág: `feat/web-voice-cascade`. Minden commit végén: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Csak explicit útvonalú `git add`.** A `.env`-hez és a követetlen `docs/projekt-statusz.md`-hez nem nyúlunk. Push, PR és merge csak kifejezett jóváhagyással.
- Új függőség: **kizárólag** `@ai-sdk/openai` `2.0.135`, pontos verzióval (`--save-exact`), az `apps/web/package.json`-ban.
- `OPENAI_API_KEY` csak szerveren; semmi nem `NEXT_PUBLIC_`.
- A core `text` módban a `system` **bájtra azonos** az `ASK_AGENT_SYSTEM_PROMPT`-tal; az ask-agent négy toolja és a szöveges chat nem változik. A `docs/system-prompt.md` XML-blokkja és a `.ts` mirror nem változik.
- Hangot nem tárolunk; átirat csak a JSONL interakció-naplóba kerül; az üzemi `logger`-be csak esemény és ms (soha átirat, mondat- vagy felhasználói szöveg; hibánál csak név és státuszkód).
- Korlátok: felvétel ≤ 30 s (kliens), ≤ 2 MB, MIME-allowlist, STT/TTS időkorlát 15 s, előzmény ≤ 20 üzenet (üzenetenként ≤ 2000 karakter), felolvasott szöveg ≤ 1200 karakter/forduló.
- Időküszöbök: `< 800 ms` zöld (`good`), `> 1500 ms` piros (`bad`), köztes sárga (`warn`).
- Tesztben nincs valódi OpenAI-hívás. Tesztnevek: „should … when …”. A CSS-modul osztálynevek a Vitestben `_<név>_<hash>` alakúak (`/class="_composer_/` mintával illesztünk).
- Parancsok a repó gyökeréből: `pnpm nx test <projekt> -- <fájl>`, `pnpm nx run-many -t lint,typecheck`.
- A fájlok 200–400 sorosak, max 800; egy fogalom = egy könyvtár (`apps/web/src/voice/`), a teszt a kód mellett.

## Review Focus

A spec sugallja, de egyetlen feladat „boldog útja” sem fedi le. Mindegyikhez van teszt a megjelölt feladatban:

1. **Üres/csendes felvétel:** az SDK `NoTranscriptGeneratedError`-t dob → „Nem hallottam semmit”, LLM- és TTS-hívás nélkül (Task 4).
2. **Magyar mondathatárok:** `„… 2,5 m magas. Kb. 20 cm-es cserépben.”` két mondat, a `Kb.` nem határ; a „2 490 Ft.” mondatvégi pont tényleg határ (Task 2).
3. **Dupla indítás:** gyors újranyomás, a `keydown` `repeat`-je és a szóköz+kattintás egyszerre sem indít második felvételt (Task 5, állapotgép).
4. **Markdown a válaszban** (a modell figyelmen kívül hagyja a promptot): `**`, lista, link a TTS-nek tisztán, felolvasható szövegként megy (Task 2).
5. **Megszakítás/hiba folyamközben:** a TTS-sorrend megmarad akkor is, ha a 2. mondat hamarabb kész; abortnál nincs kezeletlen elutasítás és nincs `error` esemény; TTS-hiba `error` eseményt ad, a naplóban csak név+státusz (Task 3, 4).

---

## File Structure

**Core (módosul/új):**
- Create: `packages/core/src/agents/ask-agent/voice-prompt.ts`
- Modify: `packages/core/src/agents/ask-agent/ask-agent-stream.ts`, `ask-agent-stream.spec.ts`, `packages/core/src/index.ts`
- Modify: `docs/system-prompt.md` (csak az XML-en kívüli megjegyzés)

**Web, szerver (`apps/web/src/voice/`):**
- `voice-events.ts` — a `VoiceEvent` unió (szerver és kliens közös szerződése)
- `timing-thresholds.ts` — `timingTone`
- `spoken-text.ts` — mondatbontó, markdown-tisztítás, felolvasási keret
- `voice-request-schema.ts` — szigorú kérésfeldolgozás, `VoiceRequestError`
- `voice-config.ts` — env, alapértékek, `VoiceNotConfiguredError`
- `transcription-fetch.ts` — `PLANT_KEYWORDS`, a `gpt-transcribe` fetch-wrapper
- `voice-providers.ts` — `createVoiceDeps` (`createOpenAI`)
- `transcribe-audio.ts`, `synthesize-speech.ts` — az SDK-hívások időkorláttal
- `speech-queue.ts` — párhuzamos TTS, sorrendtartó kibocsátás
- `filler-texts.ts`, `filler-cache.ts` — kitöltő mondatok és cache
- `voice-turn.ts` — a teljes forduló (STT → agent → TTS) eseményekkel
- `voice-handler.ts` — HTTP réteg (`handleVoiceRequest`)
- `safe-error-fields.ts` — naplózható hibamezők
- `app/api/voice/route.ts`, `app/api/voice/warmup/route.ts`

**Web, kliens (`apps/web/src/voice/` és `app/voice/`):**
- `ndjson-parser.ts`, `voice-state.ts`, `push-to-talk-machine.ts`, `recording-format.ts`, `audio-queue.ts` — tiszta logika
- `voice-client.ts`, `use-push-to-talk.ts`, `waterfall-panel.tsx`, `voice-panel.tsx`, `voice.module.css`
- `app/voice/page.tsx`; link a `app/page.tsx`-en

---

### Task 1: Core — `mode` opció és `VOICE_PROMPT_SECTION`

**Files:**
- Create: `packages/core/src/agents/ask-agent/voice-prompt.ts`
- Modify: `packages/core/src/agents/ask-agent/ask-agent-stream.ts`
- Modify: `packages/core/src/agents/ask-agent/ask-agent-stream.spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `docs/system-prompt.md` (a záró ``` után)

**Interfaces:**
- Produces: `VOICE_PROMPT_SECTION: string`; `StreamAskAgentOptions.mode?: 'text' | 'voice'`; a `core` exportjai: `VOICE_PROMPT_SECTION`, `RUN_SQL_TOOL_NAME`, `SEARCH_KNOWLEDGE_TOOL_NAME`, `LIST_CATEGORIES_TOOL_NAME`, `CUSTOMER_PREFERENCES_TOOL_NAME`, `type AskAgentMode`.

- [ ] **Step 1: Write the failing tests** — a `describe('streamAskAgent', …)` blokk végére, a `ask-agent-stream.spec.ts`-be:

```ts
describe('streamAskAgent mode', () => {
  function systemSentTo(model: MockLanguageModelV2): string {
    const first = model.doStreamCalls[0]?.prompt[0];
    return first?.role === 'system' ? first.content : '';
  }

  it('should send the shared prompt byte for byte when no mode is given', async () => {
    const model = makeModel('Szia!');
    await runToCompletion(question, model);

    expect(systemSentTo(model)).toBe(ASK_AGENT_SYSTEM_PROMPT);
  });

  it('should send the shared prompt byte for byte in text mode', async () => {
    const model = makeModel('Szia!');
    const result = streamAskAgent(question, { model, mode: 'text' });
    await result.text;

    expect(systemSentTo(model)).toBe(ASK_AGENT_SYSTEM_PROMPT);
  });

  it('should append the voice section after the shared prompt in voice mode', async () => {
    const model = makeModel('Szia!');
    const result = streamAskAgent(question, { model, mode: 'voice' });
    await result.text;

    expect(systemSentTo(model)).toBe(
      ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION,
    );
  });

  it('should log the effective system prompt in voice mode', async () => {
    let resolveLogPath: (path: string) => void = () => undefined;
    const logPathPromise = new Promise<string>((resolve) => {
      resolveLogPath = resolve;
    });
    const result = streamAskAgent(question, {
      model: makeModel('Szia!'),
      mode: 'voice',
      onLogWritten: resolveLogPath,
    });
    await result.text;
    const logPath = await logPathPromise;

    const entry = JSON.parse((await readFile(logPath, 'utf8')).trim());
    await rm(logPath, { force: true });
    expect(entry.system).toBe(ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION);
  });
});
```

Importok a fájl tetején: `import { VOICE_PROMPT_SECTION } from './voice-prompt.js';`. (Ha a meglévő tesztek más módon olvassák/törlik a logot, a `readFile`/`rm` használatát igazítsd ahhoz — a fájl már importálja őket.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test core -- src/agents/ask-agent/ask-agent-stream.spec.ts`
Expected: FAIL — `./voice-prompt.js` nem található.

- [ ] **Step 3: Write `voice-prompt.ts`**

```ts
// packages/core/src/agents/ask-agent/voice-prompt.ts
//
// The spoken-answer addendum of the ask-agent's system prompt. It is NOT
// part of docs/system-prompt.md's XML (and so not of the ask-agent-prompt.ts
// mirror): the shared prompt stays untouched, and `streamAskAgent` appends
// this section only in `voice` mode.

export const VOICE_PROMPT_SECTION = `
<voice>
A válaszod fel lesz olvasva, nem olvasni fogják: úgy fogalmazz, ahogy egy barátságos, szakértő növényes eladó mondaná élőszóban.
- Rövid, egyszerű mondatok; összesen legfeljebb 3-4 mondat, kivéve ha a felhasználó kifejezetten részletet kér.
- Egyszerre legfeljebb egy kérdést tegyél fel.
- Nincs markdown, felsorolásjel, táblázat, kód, emoji és link. Több találatnál legfeljebb három nevet mondj egy mondatban; ha ennél több van, mondd ki, hány találat van, és kérdezz rá egy szűkítő szempontra (például fény, méret, ár vagy háziállat).
- Számokat és árakat kimondható alakban írj: "forint", nem "Ft"; "centiméter", nem "cm"; "körülbelül", nem "kb.". Az árat pontosan mondd, ne kerekítsd.
- A latin nevet csak akkor mondd, ha kérik.
- Forrásnál ne URL-t mondj: természetesen utalj rá ("a gondozási tudástár szerint").
- A kérdés gépi átirat, lehet benne félrehallás. Ha egy szó vagy növénynév furcsa, vagy a kérés nem egyértelmű, ne találgass: röviden kérdezz vissza ("Jól értem, hogy ... ?").
- Ez a szakasz csak a megfogalmazás módját írja felül. Az SQL-, adat-, biztonsági és eszkalációs szabályok változatlanok: ha át kell adni a kérdést, a válasz továbbra is az [ESCALATE] előtaggal kezdődik.
</voice>
`;
```

- [ ] **Step 4: Wire the mode into `ask-agent-stream.ts`**

Importok közé: `import { VOICE_PROMPT_SECTION } from './voice-prompt.js';`

A `StreamAskAgentOptions`-be (és fölé a típus):

```ts
/** `text` (default) is the shared prompt as is; `voice` appends the spoken-answer section. */
export type AskAgentMode = 'text' | 'voice';
```
```ts
  /** Which prompt variant to run; defaults to `text`. */
  mode?: AskAgentMode;
```

A `streamAskAgent` törzsében:

```ts
  StreamAskAgentInputSchema.parse(messages);

  const system = systemPromptFor(options.mode ?? 'text');
  const logOnce = createInteractionLogger(messages, system, options.onLogWritten);
```
és a `streamText({ … system: ASK_AGENT_SYSTEM_PROMPT, …})` → `system,`.

A fájl aljára:

```ts
function systemPromptFor(mode: AskAgentMode): string {
  return mode === 'voice'
    ? ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION
    : ASK_AGENT_SYSTEM_PROMPT;
}
```

`createInteractionLogger(messages, onLogWritten)` → `createInteractionLogger(messages, system, onLogWritten)`, benne `buildLogEntry(messages, system, request)`; a `buildLogEntry` szignatúrája `(messages, system, { outcome, steps, error })`, és a `system: ASK_AGENT_SYSTEM_PROMPT` sor `system,` lesz.

- [ ] **Step 5: Export from `packages/core/src/index.ts`** — az `ask-agent-stream` export blokkba `type AskAgentMode`, és új blokkok:

```ts
export { VOICE_PROMPT_SECTION } from './agents/ask-agent/voice-prompt.js';
export { CUSTOMER_PREFERENCES_TOOL_NAME } from './tools/customer-preferences/customer-preferences-tool.js';
export { LIST_CATEGORIES_TOOL_NAME } from './tools/list-categories/list-categories-tool.js';
export { RUN_SQL_TOOL_NAME } from './tools/run-sql/run-sql-tool.js';
export { SEARCH_KNOWLEDGE_TOOL_NAME } from './tools/search-knowledge/search-knowledge-tool.js';
```

- [ ] **Step 6: Short reference in `docs/system-prompt.md`** — a fájl végére, a záró ```` ``` ```` után (az XML-blokk nem változik):

```markdown

> **Voice mód:** a `/voice` oldal (`streamAskAgent(..., { mode: 'voice' })`) ehhez a prompthoz még hozzáfűzi a `<voice>` szekciót; annak szövege nem itt, hanem a `packages/core/src/agents/ask-agent/voice-prompt.ts` `VOICE_PROMPT_SECTION` konstansában él (így nincs új szinkron-teher).
```

- [ ] **Step 7: Verify the mirror is untouched, run tests**

Run: `git diff --stat -- packages/core/src/agents/ask-agent/ask-agent-prompt.ts` → üres.
Run: `pnpm nx test core -- src/agents/ask-agent` → a meglévő toolkészlet-tesztek és az új tesztek PASS.
Run: `pnpm nx run-many -t lint,typecheck -p core` → PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agents/ask-agent/voice-prompt.ts packages/core/src/agents/ask-agent/ask-agent-stream.ts packages/core/src/agents/ask-agent/ask-agent-stream.spec.ts packages/core/src/index.ts docs/system-prompt.md
git commit -m "feat(core): add the voice mode to the streaming ask-agent

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tiszta segédek — eseményszerződés, időküszöbök, felolvasott szöveg, kérés-séma

**Files:**
- Create: `apps/web/src/voice/voice-events.ts`, `timing-thresholds.ts`, `spoken-text.ts`, `voice-request-schema.ts`
- Test: `timing-thresholds.spec.ts`, `spoken-text.spec.ts`, `voice-request-schema.spec.ts` (ugyanott)

**Interfaces:**
- Produces:
  - `type VoiceEvent` (lásd lent), `isVoiceEvent(value: unknown): value is VoiceEvent`
  - `timingTone(ms: number): 'good' | 'warn' | 'bad'`, `type TimingTone`
  - `createSentenceSplitter(): { push(chunk: string): string[]; flush(): string[] }`
  - `stripMarkdown(text: string): string`
  - `createSpokenBudget(max?: number): { take(sentence: string): string | null }`, `MAX_SPOKEN_CHARS = 1200`, `CLOSING_SENTENCE`
  - `parseVoiceRequest(form: FormData): Promise<VoiceRequest>`, `VoiceRequestError`, `MAX_AUDIO_BYTES`, `ALLOWED_AUDIO_TYPES`, `interface HistoryMessage`

- [ ] **Step 1: Write `voice-events.ts`** (nincs teszt: tiszta típus + egy egyszerű őr, amit a Task 5 parser tesztje fed)

```ts
// The server → client contract of POST /api/voice: one JSON object per
// NDJSON line. Audio is base64-encoded mp3.

export type VoiceEvent =
  | { type: 'transcript'; text: string; sttMs: number }
  | { type: 'tool'; name: string }
  | { type: 'filler'; text: string; audio: string }
  | { type: 'text-delta'; text: string }
  | {
      type: 'sentence';
      index: number;
      text: string;
      audio: string;
      ttsMs: number;
    }
  | { type: 'escalated' }
  | {
      type: 'timing';
      sttMs: number;
      firstTokenMs: number | null;
      firstSentenceMs: number | null;
      totalMs: number;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'transcript',
  'tool',
  'filler',
  'text-delta',
  'sentence',
  'escalated',
  'timing',
  'done',
  'error',
]);

export function isVoiceEvent(value: unknown): value is VoiceEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    EVENT_TYPES.has(value.type)
  );
}
```

- [ ] **Step 2: Write the failing `timing-thresholds.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { timingTone } from './timing-thresholds';

describe('timingTone', () => {
  it.each([
    [0, 'good'],
    [799, 'good'],
    [800, 'warn'],
    [1500, 'warn'],
    [1501, 'bad'],
    [6000, 'bad'],
  ] as const)('should classify %i ms as %s', (ms, tone) => {
    expect(timingTone(ms)).toBe(tone);
  });
});
```

- [ ] **Step 3: Run → FAIL** (`pnpm nx test web -- src/voice/timing-thresholds.spec.ts`), majd:

```ts
// apps/web/src/voice/timing-thresholds.ts
export type TimingTone = 'good' | 'warn' | 'bad';

export const GOOD_BELOW_MS = 800;
export const BAD_ABOVE_MS = 1500;

/** green < 800 ms, red > 1500 ms, amber in between. */
export function timingTone(ms: number): TimingTone {
  if (ms < GOOD_BELOW_MS) {
    return 'good';
  }
  return ms > BAD_ABOVE_MS ? 'bad' : 'warn';
}
```

Run → PASS.

- [ ] **Step 4: Write the failing `spoken-text.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  CLOSING_SENTENCE,
  createSentenceSplitter,
  createSpokenBudget,
  stripMarkdown,
} from './spoken-text';

function splitAll(chunks: string[]): string[] {
  const splitter = createSentenceSplitter();
  return [...chunks.flatMap((c) => splitter.push(c)), ...splitter.flush()];
}

describe('createSentenceSplitter', () => {
  it('should emit a sentence only once its end is known', () => {
    const splitter = createSentenceSplitter();

    expect(splitter.push('Az első mondat.')).toEqual([]);
    expect(splitter.push(' A második')).toEqual(['Az első mondat.']);
    expect(splitter.flush()).toEqual(['A második']);
  });

  it('should not split at a Hungarian abbreviation', () => {
    expect(
      splitAll(['A ficus 2,5 m magas. Kb. 20 cm-es cserépben van. Szép.']),
    ).toEqual(['A ficus 2,5 m magas.', 'Kb. 20 cm-es cserépben van.', 'Szép.']);
  });

  it('should not split inside a decimal point or thousands grouping', () => {
    expect(splitAll(['Ára 2 490 Ft. Van 2.5 literes cserép is.'])).toEqual([
      'Ára 2 490 Ft.',
      'Van 2.5 literes cserép is.',
    ]);
  });

  it('should split at a sentence-final number', () => {
    expect(splitAll(['Összesen 3. Köszönöm.'])).toEqual([
      'Összesen 3.',
      'Köszönöm.',
    ]);
  });

  it('should split on ? and ! and survive chunk boundaries inside a word', () => {
    expect(splitAll(['Szeretnél töb', 'bet tudni? Igen! Kérdezz.'])).toEqual([
      'Szeretnél többet tudni?',
      'Igen!',
      'Kérdezz.',
    ]);
  });
});

describe('stripMarkdown', () => {
  it('should remove emphasis, headings, list markers and links', () => {
    expect(
      stripMarkdown('## Cím\n- **Monstera** [itt](https://x.hu) _szép_ `kód`'),
    ).toBe('Cím Monstera itt szép kód');
  });

  it('should return an empty string for markdown-only input', () => {
    expect(stripMarkdown('**')).toBe('');
  });
});

describe('createSpokenBudget', () => {
  it('should let sentences through while the budget lasts', () => {
    const budget = createSpokenBudget(20);

    expect(budget.take('Rövid.')).toBe('Rövid.');
    expect(budget.take('Még egy.')).toBe('Még egy.');
  });

  it('should replace the first overflowing sentence with the closing line, then drop the rest', () => {
    const budget = createSpokenBudget(20);
    budget.take('Tizenkét betű.');

    expect(budget.take('Ez már túl hosszú mondat.')).toBe(CLOSING_SENTENCE);
    expect(budget.take('Ez sem.')).toBeNull();
  });

  it('should always allow the first sentence even if it exceeds the budget', () => {
    const budget = createSpokenBudget(5);

    expect(budget.take('Egy nagyon hosszú első mondat.')).toBe(
      'Egy nagyon hosszú első mondat.',
    );
  });
});
```

- [ ] **Step 5: Run → FAIL, then write `spoken-text.ts`**

```ts
// apps/web/src/voice/spoken-text.ts
//
// What gets read aloud: the model's streamed text is cut into sentences,
// cleaned of markdown (a safety net next to the <voice> prompt) and capped
// per turn. Pure functions, no I/O.

const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'pl',
  'kb',
  'stb',
  'db',
  'ún',
  'ill',
  'ca',
  'max',
  'min',
  'tel',
  'dr',
  'vö',
  'ld',
]);

export const MAX_SPOKEN_CHARS = 1200;
export const CLOSING_SENTENCE = 'A többit leírva láthatod.';

export interface SentenceSplitter {
  /** Adds streamed text; returns the sentences that are now complete. */
  push(chunk: string): string[];
  /** Returns the unfinished remainder (end of the answer). */
  flush(): string[];
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = '';

  const takeComplete = (): string[] => {
    const sentences: string[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const char = buffer[i];
      if (char !== '.' && char !== '!' && char !== '?') {
        continue;
      }
      const next = buffer[i + 1];
      if (next === undefined) {
        break; // the boundary cannot be decided before the next character
      }
      if (!/\s/.test(next)) {
        continue; // 2.5, "...", a.b
      }
      if (char === '.' && isNotSentenceEnd(buffer.slice(start, i))) {
        continue;
      }
      sentences.push(buffer.slice(start, i + 1).trim());
      start = i + 1;
    }
    buffer = buffer.slice(start);
    return sentences.filter((sentence) => sentence.length > 0);
  };

  return {
    push(chunk) {
      buffer += chunk;
      return takeComplete();
    },
    flush() {
      const rest = buffer.trim();
      buffer = '';
      return rest.length > 0 ? [rest] : [];
    },
  };
}

/** `before` is the sentence so far, without the period being judged. */
function isNotSentenceEnd(before: string): boolean {
  const lastWord = before.split(/\s/).pop()?.toLowerCase() ?? '';
  return ABBREVIATIONS.has(lastWord) || /^\d+$/.test(before.trim());
}

/** Plain, speakable text from a (possibly markdown) sentence. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

export interface SpokenBudget {
  /** The sentence to speak, the closing line once, or null once over budget. */
  take(sentence: string): string | null;
}

export function createSpokenBudget(max: number = MAX_SPOKEN_CHARS): SpokenBudget {
  let used = 0;
  let isClosed = false;

  return {
    take(sentence) {
      if (isClosed) {
        return null;
      }
      if (used > 0 && used + sentence.length > max) {
        isClosed = true;
        return CLOSING_SENTENCE;
      }
      used += sentence.length;
      return sentence;
    },
  };
}
```

Run → PASS. (Ha a `stripMarkdown` első teszt kimenete a pontos szóközöknél eltér, a **tesztet** igazítsd a függvény szándékolt viselkedéséhez — egy szóköz a szavak között —, ne a függvényt egy véletlen kimenethez.)

- [ ] **Step 6: Write the failing `voice-request-schema.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  parseVoiceRequest,
  VoiceRequestError,
} from './voice-request-schema';

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

const audio = (type = 'audio/webm;codecs=opus', size = 10) =>
  new Blob([new Uint8Array(size)], { type });

describe('parseVoiceRequest', () => {
  it('should accept audio without history and strip the codecs parameter', async () => {
    const result = await parseVoiceRequest(form({ audio: audio() }));

    expect(result.mediaType).toBe('audio/webm');
    expect(result.audio).toHaveLength(10);
    expect(result.history).toEqual([]);
  });

  it('should accept a valid history', async () => {
    const history = JSON.stringify([
      { role: 'user', content: 'Szia' },
      { role: 'assistant', content: 'Szia, miben segíthetek?' },
    ]);

    const result = await parseVoiceRequest(form({ audio: audio(), history }));

    expect(result.history).toHaveLength(2);
  });

  it.each([
    ['an unknown field', { audio: audio(), extra: 'x' }],
    ['a missing audio', { history: '[]' }],
    ['an empty audio', { audio: audio('audio/webm', 0) }],
    ['an oversized audio', { audio: audio('audio/webm', MAX_AUDIO_BYTES + 1) }],
    ['a non-audio MIME type', { audio: audio('text/html') }],
    ['history that is not JSON', { audio: audio(), history: '{' }],
    [
      'a system message in the history',
      { audio: audio(), history: '[{"role":"system","content":"x"}]' },
    ],
    [
      'a tool message in the history',
      { audio: audio(), history: '[{"role":"tool","content":"x"}]' },
    ],
    [
      'an unknown key in a history message',
      { audio: audio(), history: '[{"role":"user","content":"x","a":1}]' },
    ],
    [
      'too long a history message',
      {
        audio: audio(),
        history: JSON.stringify([{ role: 'user', content: 'x'.repeat(2001) }]),
      },
    ],
    [
      'more than 20 history messages',
      {
        audio: audio(),
        history: JSON.stringify(
          Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' })),
        ),
      },
    ],
  ])('should reject %s', async (_name, fields) => {
    await expect(parseVoiceRequest(form(fields))).rejects.toBeInstanceOf(
      VoiceRequestError,
    );
  });
});
```

- [ ] **Step 7: Run → FAIL, then write `voice-request-schema.ts`**

```ts
// apps/web/src/voice/voice-request-schema.ts
//
// The browser → /api/voice boundary: untrusted input (konvenciok.md
// "Biztonság"), validated fail-fast. Strict: an unknown field is an error.

import { z } from 'zod';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const ALLOWED_AUDIO_TYPES: readonly string[] = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
];

const ALLOWED_FIELDS: ReadonlySet<string> = new Set(['audio', 'history']);

const HistorySchema = z
  .array(
    z.strictObject({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(2000),
    }),
  )
  .max(20);

export type HistoryMessage = z.infer<typeof HistorySchema>[number];

export interface VoiceRequest {
  audio: Uint8Array;
  /** The MIME type without parameters, e.g. `audio/webm`. */
  mediaType: string;
  history: HistoryMessage[];
}

/** A client mistake (→ HTTP 400); its message is safe to log, never the input. */
export class VoiceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceRequestError';
  }
}

export async function parseVoiceRequest(form: FormData): Promise<VoiceRequest> {
  for (const key of form.keys()) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new VoiceRequestError('Unknown form field.');
    }
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    throw new VoiceRequestError('The audio field is missing.');
  }
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    throw new VoiceRequestError('The audio size is out of range.');
  }
  const mediaType = (audio.type.split(';')[0] ?? '').trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.includes(mediaType)) {
    throw new VoiceRequestError('Unsupported audio type.');
  }

  return {
    audio: new Uint8Array(await audio.arrayBuffer()),
    mediaType,
    history: parseHistory(form.get('history')),
  };
}

function parseHistory(raw: FormDataEntryValue | null): HistoryMessage[] {
  if (raw === null) {
    return [];
  }
  if (typeof raw !== 'string') {
    throw new VoiceRequestError('The history must be text.');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new VoiceRequestError('The history is not valid JSON.');
  }
  const parsed = HistorySchema.safeParse(json);
  if (!parsed.success) {
    throw new VoiceRequestError('The history is invalid.');
  }
  return parsed.data;
}
```

Run → PASS.

- [ ] **Step 8: Lint/typecheck and commit**

Run: `pnpm nx run-many -t lint,typecheck,test -p web`

```bash
git add apps/web/src/voice/voice-events.ts apps/web/src/voice/timing-thresholds.ts apps/web/src/voice/timing-thresholds.spec.ts apps/web/src/voice/spoken-text.ts apps/web/src/voice/spoken-text.spec.ts apps/web/src/voice/voice-request-schema.ts apps/web/src/voice/voice-request-schema.spec.ts
git commit -m "feat(web): add the voice pure helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Szolgáltatók, hívások, hangsor, filler-cache

**Files:**
- Modify: `apps/web/package.json` (+ `pnpm-lock.yaml`)
- Create: `voice-config.ts`, `transcription-fetch.ts`, `voice-providers.ts`, `transcribe-audio.ts`, `synthesize-speech.ts`, `speech-queue.ts`, `filler-texts.ts`, `filler-cache.ts`, `safe-error-fields.ts` (mind `apps/web/src/voice/`)
- Test: `voice-config.spec.ts`, `transcription-fetch.spec.ts`, `transcribe-audio.spec.ts`, `speech-queue.spec.ts`, `filler-cache.spec.ts`, `safe-error-fields.spec.ts`

**Interfaces:**
- Consumes: `VoiceRequestError` (Task 2).
- Produces:
  - `readVoiceConfig(env?): VoiceConfig` (`{ apiKey: string | undefined; sttModel: string; ttsModel: string; voice: string }`), `VoiceNotConfiguredError`, `NOT_CONFIGURED_MESSAGE`
  - `PLANT_KEYWORDS: readonly string[]`, `createTranscriptionFetch(base?: typeof fetch): typeof fetch`
  - `type VoiceTranscriptionModel`, `type VoiceSpeechModel`, `interface VoiceDeps { config: VoiceConfig; transcriptionModel: VoiceTranscriptionModel; speechModel: VoiceSpeechModel; askModel?: LanguageModel }`, `createVoiceDeps(config): VoiceDeps`
  - `transcribeAudio({ model, modelId, audio, signal }): Promise<{ text: string; durationInSeconds: number | undefined }>` (üres átirat → `text: ''`)
  - `synthesizeSpeech({ model, voice, text, signal }): Promise<Uint8Array>`
  - `createSpeechQueue({ synthesize, onSentence, concurrency?, now? }): { enqueue(text: string): void; finish(): Promise<void> }`; `interface SpokenSentence { index; text; audio: Uint8Array; ttsMs }`
  - `fillerTextForTool(toolName: string): string | undefined`, `STILL_SEARCHING_TEXT`, `ALL_FILLER_TEXTS`
  - `warmFillers({ model, voice, synthesize, onFailure }): Promise<void>`, `getFillerIfReady({ model, voice, text }): Uint8Array | undefined`, `clearFillerCache(): void`
  - `safeErrorFields(error: unknown): { errorName: string; statusCode?: number }`

- [ ] **Step 1: Install the dependency (pontos verzió)**

Run: `pnpm --filter web add @ai-sdk/openai@2.0.135 --save-exact`
Ellenőrzés: az `apps/web/package.json` `dependencies`-ében `"@ai-sdk/openai": "2.0.135"` (nincs `^`); `pnpm ls ai --depth 2 -r` egyetlen `ai@5.0.261`-et mutat.

- [ ] **Step 2: Write the failing `voice-config.spec.ts`, then `voice-config.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { readVoiceConfig } from './voice-config';

describe('readVoiceConfig', () => {
  it('should use the defaults when nothing is set', () => {
    expect(readVoiceConfig({})).toEqual({
      apiKey: undefined,
      sttModel: 'gpt-transcribe',
      ttsModel: 'gpt-4o-mini-tts',
      voice: 'coral',
    });
  });

  it('should override the models and the voice from the environment', () => {
    const config = readVoiceConfig({
      OPENAI_API_KEY: 'sk-test',
      VOICE_STT_MODEL: 'gpt-4o-mini-transcribe',
      VOICE_TTS_MODEL: 'tts-1',
      VOICE_TTS_VOICE: 'alloy',
    });

    expect(config).toEqual({
      apiKey: 'sk-test',
      sttModel: 'gpt-4o-mini-transcribe',
      ttsModel: 'tts-1',
      voice: 'alloy',
    });
  });

  it('should treat empty values (as in .env.example) as unset', () => {
    const config = readVoiceConfig({ OPENAI_API_KEY: '', VOICE_STT_MODEL: '' });

    expect(config.apiKey).toBeUndefined();
    expect(config.sttModel).toBe('gpt-transcribe');
  });
});
```

```ts
// apps/web/src/voice/voice-config.ts
export const DEFAULT_STT_MODEL = 'gpt-transcribe';
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_TTS_VOICE = 'coral';

export const NOT_CONFIGURED_MESSAGE =
  'A hangfunkció nincs beállítva (hiányzik az OPENAI_API_KEY).';

export interface VoiceConfig {
  apiKey: string | undefined;
  sttModel: string;
  ttsModel: string;
  voice: string;
}

export class VoiceNotConfiguredError extends Error {
  constructor() {
    super(NOT_CONFIGURED_MESSAGE);
    this.name = 'VoiceNotConfiguredError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

export function readVoiceConfig(env: Env = process.env): VoiceConfig {
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    apiKey: read('OPENAI_API_KEY'),
    sttModel: read('VOICE_STT_MODEL') ?? DEFAULT_STT_MODEL,
    ttsModel: read('VOICE_TTS_MODEL') ?? DEFAULT_TTS_MODEL,
    voice: read('VOICE_TTS_VOICE') ?? DEFAULT_TTS_VOICE,
  };
}
```

- [ ] **Step 3: Write the failing `transcription-fetch.spec.ts`, then `transcription-fetch.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTranscriptionFetch, PLANT_KEYWORDS } from './transcription-fetch';

const URL_TRANSCRIPTIONS = 'https://api.openai.com/v1/audio/transcriptions';

function body(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  form.append('file', new File([new Uint8Array(3)], 'audio.webm'));
  return form;
}

function sentBody(base: ReturnType<typeof vi.fn>): FormData {
  return (base.mock.calls[0]?.[1] as RequestInit).body as FormData;
}

describe('createTranscriptionFetch', () => {
  it('should drop response_format and add languages and keywords for gpt-transcribe', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const wrapped = createTranscriptionFetch(base);

    await wrapped(URL_TRANSCRIPTIONS, {
      method: 'POST',
      body: body({ model: 'gpt-transcribe', response_format: 'verbose_json' }),
    });

    const sent = sentBody(base);
    expect(sent.get('response_format')).toBeNull();
    expect(sent.getAll('languages[]')).toEqual(['hu']);
    expect(sent.getAll('keywords[]')).toEqual([...PLANT_KEYWORDS]);
    expect(sent.get('model')).toBe('gpt-transcribe');
    expect(sent.get('file')).toBeInstanceOf(File);
  });

  it('should never send both language and languages', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));

    await createTranscriptionFetch(base)(URL_TRANSCRIPTIONS, {
      method: 'POST',
      body: body({ model: 'gpt-transcribe', language: 'hu' }),
    });

    expect(sentBody(base).get('language')).toBeNull();
  });

  it('should leave other models untouched', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const original = body({ model: 'gpt-4o-transcribe', language: 'hu' });

    await createTranscriptionFetch(base)(URL_TRANSCRIPTIONS, {
      method: 'POST',
      body: original,
    });

    expect(sentBody(base)).toBe(original);
  });

  it('should leave other URLs untouched', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const original = body({ model: 'gpt-transcribe' });

    await createTranscriptionFetch(base)('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      body: original,
    });

    expect(sentBody(base)).toBe(original);
  });
});

describe('PLANT_KEYWORDS', () => {
  it('should satisfy the API rules for keywords', () => {
    for (const keyword of PLANT_KEYWORDS) {
      expect(keyword).not.toMatch(/[<>\r\n]/);
      expect(keyword.trim()).toBe(keyword);
      expect(keyword.length).toBeGreaterThan(0);
    }
  });
});
```

```ts
// apps/web/src/voice/transcription-fetch.ts
//
// `gpt-transcribe` takes `keywords[]` and `languages[]`, which the pinned
// @ai-sdk/openai (2.0.135) has no option for, and it does not list
// `verbose_json` (the SDK's default for non-gpt-4o models). So the request
// body is adjusted on its way out — the call itself stays an SDK
// `transcribe()`, and swapping the provider stays a one-line change.

/** Literal terms the recognizer should get right (one line each, no < >). */
export const PLANT_KEYWORDS: readonly string[] = [
  'monstera',
  'fikusz',
  'pozsgás',
  'kaktusz',
  'orchidea',
  'pálma',
  'szansevéria',
  'zamiokulkász',
  'tradeszkáncia',
  'hoya',
  'aloe vera',
  'bazsalikom',
  'citromfa',
  'kerti növény',
  'szobanövény',
  'pet-safe',
];

const TRANSCRIPTIONS_PATH = '/audio/transcriptions';
const DROPPED_FIELDS: ReadonlySet<string> = new Set([
  'response_format',
  'language',
  'languages[]',
]);

export function createTranscriptionFetch(
  base: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const body = init?.body;
    if (
      urlOf(input).endsWith(TRANSCRIPTIONS_PATH) &&
      body instanceof FormData &&
      body.get('model') === 'gpt-transcribe'
    ) {
      return base(input, { ...init, body: adjusted(body) });
    }
    return base(input, init);
  };
}

function adjusted(original: FormData): FormData {
  const next = new FormData();
  for (const [key, value] of original.entries()) {
    if (!DROPPED_FIELDS.has(key)) {
      next.append(key, value);
    }
  }
  next.append('languages[]', 'hu');
  for (const keyword of PLANT_KEYWORDS) {
    next.append('keywords[]', keyword);
  }
  return next;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}
```

- [ ] **Step 4: Write `voice-providers.ts`** (vékony összekötés, a teszt a handleren át fedi)

```ts
// apps/web/src/voice/voice-providers.ts
import { createOpenAI } from '@ai-sdk/openai';
import type {
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  LanguageModel,
} from 'ai';
import { createTranscriptionFetch } from './transcription-fetch';
import { VoiceNotConfiguredError, type VoiceConfig } from './voice-config';

export type VoiceTranscriptionModel = Parameters<typeof transcribe>[0]['model'];
export type VoiceSpeechModel = Parameters<typeof generateSpeech>[0]['model'];

export interface VoiceDeps {
  config: VoiceConfig;
  transcriptionModel: VoiceTranscriptionModel;
  speechModel: VoiceSpeechModel;
  /** Test seam: replaces the real ask-agent model. */
  askModel?: LanguageModel;
}

/** The one place that names the provider; change it here to swap it. */
export function createVoiceDeps(config: VoiceConfig): VoiceDeps {
  if (config.apiKey === undefined) {
    throw new VoiceNotConfiguredError();
  }
  const openai = createOpenAI({
    apiKey: config.apiKey,
    fetch: createTranscriptionFetch(),
  });
  return {
    config,
    transcriptionModel: openai.transcription(config.sttModel),
    speechModel: openai.speech(config.ttsModel),
  };
}
```

Ha a `typeof transcribe` típus-import a lintben/tsc-ben panaszt kap (`import type` + `typeof`), használd az érték-importot `import { experimental_transcribe, … } from 'ai'` és `Parameters<typeof experimental_transcribe>`-t.

- [ ] **Step 5: Write the failing `transcribe-audio.spec.ts`, then `transcribe-audio.ts` and `safe-error-fields`**

```ts
import { MockTranscriptionModelV2 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { transcribeAudio } from './transcribe-audio';
import { VoiceRequestError } from './voice-request-schema';

function modelReturning(text: string, durationInSeconds: number | undefined = 3) {
  const calls: unknown[] = [];
  const model = new MockTranscriptionModelV2({
    doGenerate: async (options) => {
      calls.push(options);
      return {
        text,
        segments: [],
        language: 'hu',
        durationInSeconds,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      };
    },
  });
  return { model, calls };
}

const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]); // webm magic
const signal = new AbortController().signal;

describe('transcribeAudio', () => {
  it('should return the transcript', async () => {
    const { model } = modelReturning('Milyen kaktuszaitok vannak?');

    const result = await transcribeAudio({ model, modelId: 'gpt-transcribe', audio, signal });

    expect(result.text).toBe('Milyen kaktuszaitok vannak?');
  });

  it('should return an empty text when the model heard nothing', async () => {
    const { model } = modelReturning('');

    const result = await transcribeAudio({ model, modelId: 'gpt-transcribe', audio, signal });

    expect(result.text).toBe('');
  });

  it('should send no provider options for gpt-transcribe (the fetch wrapper adds the hints)', async () => {
    const { model, calls } = modelReturning('szia');
    await transcribeAudio({ model, modelId: 'gpt-transcribe', audio, signal });

    expect((calls[0] as { providerOptions?: unknown }).providerOptions).toBeUndefined();
  });

  it('should send language and prompt options for other models', async () => {
    const { model, calls } = modelReturning('szia');
    await transcribeAudio({ model, modelId: 'gpt-4o-mini-transcribe', audio, signal });

    const options = (calls[0] as { providerOptions: { openai: Record<string, string> } })
      .providerOptions.openai;
    expect(options.language).toBe('hu');
    expect(options.prompt).toContain('monstera');
  });

  it('should reject a recording longer than the limit', async () => {
    const { model } = modelReturning('szia', 45);

    await expect(
      transcribeAudio({ model, modelId: 'gpt-transcribe', audio, signal }),
    ).rejects.toBeInstanceOf(VoiceRequestError);
  });
});
```

```ts
// apps/web/src/voice/transcribe-audio.ts
import { experimental_transcribe as transcribe, NoTranscriptGeneratedError } from 'ai';
import { PLANT_KEYWORDS } from './transcription-fetch';
import type { VoiceTranscriptionModel } from './voice-providers';
import { VoiceRequestError } from './voice-request-schema';

export const STT_TIMEOUT_MS = 15_000;
/** The client stops at 30 s; one second of slack for the container. */
export const MAX_AUDIO_SECONDS = 31;

export interface TranscribeAudioInput {
  model: VoiceTranscriptionModel;
  modelId: string;
  audio: Uint8Array;
  signal: AbortSignal;
}

export interface Transcript {
  /** Empty when the model heard nothing. */
  text: string;
  durationInSeconds: number | undefined;
}

export async function transcribeAudio({
  model,
  modelId,
  audio,
  signal,
}: TranscribeAudioInput): Promise<Transcript> {
  try {
    const result = await transcribe({
      model,
      audio,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(STT_TIMEOUT_MS)]),
      maxRetries: 0, // a voice turn is latency-bound: fail fast, the user can retry
      // gpt-transcribe gets its hints through the fetch wrapper
      // (transcription-fetch.ts); the other models take them as options.
      ...(modelId === 'gpt-transcribe'
        ? {}
        : {
            providerOptions: {
              openai: {
                language: 'hu',
                prompt: `Magyar nyelvű beszélgetés növényekről: ${PLANT_KEYWORDS.join(', ')}.`,
              },
            },
          }),
    });
    if (
      result.durationInSeconds !== undefined &&
      result.durationInSeconds > MAX_AUDIO_SECONDS
    ) {
      throw new VoiceRequestError('A felvétel túl hosszú.');
    }
    return { text: result.text, durationInSeconds: result.durationInSeconds };
  } catch (error: unknown) {
    // The SDK throws when the transcript is empty (silence).
    if (NoTranscriptGeneratedError.isInstance(error)) {
      return { text: '', durationInSeconds: undefined };
    }
    throw error;
  }
}
```

```ts
// apps/web/src/voice/safe-error-fields.ts
//
// Log fields for a failed voice call. The AI SDK's APICallError carries the
// request body (for TTS: the sentence being spoken), so only the error's
// name and HTTP status ever reach the ops log (CLAUDE.md: no user content).

export interface SafeErrorFields {
  errorName: string;
  statusCode?: number;
}

export function safeErrorFields(error: unknown): SafeErrorFields {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'NonError' };
  }
  const name =
    'name' in error && typeof error.name === 'string' ? error.name : 'Error';
  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
  return statusCode === undefined
    ? { errorName: name }
    : { errorName: name, statusCode };
}
```

`safe-error-fields.spec.ts`:

```ts
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
```

- [ ] **Step 6: Write `synthesize-speech.ts`** (vékony SDK-hívás; a viselkedését a `speech-queue`/handler tesztek mockolt `synthesize`-jával és az integrációs teszt fedi)

```ts
// apps/web/src/voice/synthesize-speech.ts
import { experimental_generateSpeech as generateSpeech } from 'ai';
import type { VoiceSpeechModel } from './voice-providers';

export const TTS_TIMEOUT_MS = 15_000;

export interface SynthesizeSpeechInput {
  model: VoiceSpeechModel;
  voice: string;
  text: string;
  signal: AbortSignal;
}

/** One sentence → mp3 bytes. */
export async function synthesizeSpeech({
  model,
  voice,
  text,
  signal,
}: SynthesizeSpeechInput): Promise<Uint8Array> {
  const { audio } = await generateSpeech({
    model,
    text,
    voice,
    outputFormat: 'mp3',
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(TTS_TIMEOUT_MS)]),
    maxRetries: 0,
  });
  return audio.uint8Array;
}
```

- [ ] **Step 7: Write the failing `speech-queue.spec.ts`, then `speech-queue.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createSpeechQueue, type SpokenSentence } from './speech-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSpeechQueue', () => {
  it('should emit sentences in order even when a later one finishes first', async () => {
    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const pending = { 'egy': first, 'kettő': second } as const;
    const emitted: SpokenSentence[] = [];
    const queue = createSpeechQueue({
      synthesize: (text) => pending[text as keyof typeof pending].promise,
      onSentence: (sentence) => {
        emitted.push(sentence);
      },
    });

    queue.enqueue('egy');
    queue.enqueue('kettő');
    second.resolve(new Uint8Array([2]));
    await Promise.resolve();
    expect(emitted).toEqual([]);

    first.resolve(new Uint8Array([1]));
    await queue.finish();

    expect(emitted.map((s) => [s.index, s.text])).toEqual([
      [0, 'egy'],
      [1, 'kettő'],
    ]);
  });

  it('should run at most `concurrency` syntheses at once', async () => {
    let active = 0;
    let peak = 0;
    const queue = createSpeechQueue({
      concurrency: 2,
      synthesize: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Uint8Array([1]);
      },
      onSentence: () => undefined,
    });

    for (const text of ['a', 'b', 'c', 'd', 'e']) {
      queue.enqueue(text);
    }
    await queue.finish();

    expect(peak).toBe(2);
  });

  it('should report the synthesis time of each sentence', async () => {
    const times = [100, 142];
    const emitted: SpokenSentence[] = [];
    const queue = createSpeechQueue({
      now: () => times.shift() ?? 0,
      synthesize: async () => new Uint8Array([1]),
      onSentence: (sentence) => {
        emitted.push(sentence);
      },
    });

    queue.enqueue('szia');
    await queue.finish();

    expect(emitted[0]?.ttsMs).toBe(42);
  });

  it('should reject finish() when a synthesis fails, without unhandled rejections', async () => {
    const queue = createSpeechQueue({
      synthesize: async (text) => {
        if (text === 'rossz') {
          throw new Error('tts down');
        }
        return new Uint8Array([1]);
      },
      onSentence: () => undefined,
    });

    queue.enqueue('jó');
    queue.enqueue('rossz');
    queue.enqueue('utána');

    await expect(queue.finish()).rejects.toThrow('tts down');
  });
});
```

```ts
// apps/web/src/voice/speech-queue.ts
//
// Sentences are synthesized in parallel (a small limit) but handed on
// strictly in their original order, so a quick second sentence never
// overtakes a slow first one.

export interface SpokenSentence {
  index: number;
  text: string;
  audio: Uint8Array;
  ttsMs: number;
}

export interface SpeechQueueOptions {
  synthesize: (text: string) => Promise<Uint8Array>;
  onSentence: (sentence: SpokenSentence) => void | Promise<void>;
  concurrency?: number;
  now?: () => number;
}

export interface SpeechQueue {
  enqueue(text: string): void;
  /** Resolves once every enqueued sentence has been handed on; rejects on the first failure. */
  finish(): Promise<void>;
}

export function createSpeechQueue({
  synthesize,
  onSentence,
  concurrency = 2,
  now = () => performance.now(),
}: SpeechQueueOptions): SpeechQueue {
  let active = 0;
  const waiting: Array<() => void> = [];
  let nextIndex = 0;
  let chain: Promise<void> = Promise.resolve();

  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    // The slot is handed over by release(), `active` stays as it is.
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
    } else {
      next();
    }
  };

  return {
    enqueue(text) {
      const index = nextIndex;
      nextIndex += 1;
      const synthesis = (async () => {
        await acquire();
        const startedAt = now();
        try {
          const audio = await synthesize(text);
          return { audio, ttsMs: Math.round(now() - startedAt) };
        } finally {
          release();
        }
      })();
      synthesis.catch(() => undefined); // surfaced through `chain`

      chain = chain.then(async () => {
        const { audio, ttsMs } = await synthesis;
        await onSentence({ index, text, audio, ttsMs });
      });
      chain.catch(() => undefined); // surfaced through finish()
    },
    finish() {
      return chain;
    },
  };
}
```

- [ ] **Step 8: Write the failing `filler-cache.spec.ts`, then `filler-texts.ts` and `filler-cache.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFillerCache, getFillerIfReady, warmFillers } from './filler-cache';
import { ALL_FILLER_TEXTS, fillerTextForTool, STILL_SEARCHING_TEXT } from './filler-texts';

beforeEach(() => {
  clearFillerCache();
});

describe('fillerTextForTool', () => {
  it.each([
    ['runSql', 'Megnézem a katalógusban…'],
    ['searchKnowledge', 'Utánanézek a gondozási tudástárban…'],
    ['listCategories', 'Megnézem, milyen kategóriáink vannak…'],
    ['customerPreferences', 'Egy pillanat…'],
  ])('should have the agreed filler for %s', (tool, text) => {
    expect(fillerTextForTool(tool)).toBe(text);
  });

  it('should have no filler for an unknown tool', () => {
    expect(fillerTextForTool('ingestProduct')).toBeUndefined();
  });

  it('should include the 5-second refresh in the warm-up list', () => {
    expect(ALL_FILLER_TEXTS).toContain(STILL_SEARCHING_TEXT);
  });
});

describe('filler cache', () => {
  const synthesize = vi.fn(async (text: string) => new TextEncoder().encode(text));
  const onFailure = vi.fn();

  beforeEach(() => {
    synthesize.mockClear();
    onFailure.mockClear();
  });

  it('should not have a filler before the warm-up finished', () => {
    void warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });

    expect(getFillerIfReady({ model: 'm', voice: 'v', text: 'Egy pillanat…' })).toBeUndefined();
  });

  it('should serve a warmed filler without waiting', async () => {
    await warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });

    const audio = getFillerIfReady({ model: 'm', voice: 'v', text: 'Egy pillanat…' });

    expect(audio && new TextDecoder().decode(audio)).toBe('Egy pillanat…');
  });

  it('should key the cache by model and voice, so a changed voice never plays the old file', async () => {
    await warmFillers({ model: 'm', voice: 'coral', synthesize, onFailure });

    expect(getFillerIfReady({ model: 'm', voice: 'alloy', text: 'Egy pillanat…' })).toBeUndefined();
    expect(getFillerIfReady({ model: 'm2', voice: 'coral', text: 'Egy pillanat…' })).toBeUndefined();
  });

  it('should synthesize each filler once, however many times it is warmed', async () => {
    await warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });
    await warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });

    expect(synthesize).toHaveBeenCalledTimes(ALL_FILLER_TEXTS.length);
  });

  it('should report a failed filler and keep going without it', async () => {
    const failing = vi.fn(async (text: string) => {
      if (text === 'Egy pillanat…') {
        throw new Error('tts down');
      }
      return new Uint8Array([1]);
    });

    await warmFillers({ model: 'm', voice: 'v', synthesize: failing, onFailure });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(getFillerIfReady({ model: 'm', voice: 'v', text: 'Egy pillanat…' })).toBeUndefined();
    expect(getFillerIfReady({ model: 'm', voice: 'v', text: STILL_SEARCHING_TEXT })).toBeDefined();
  });
});
```

```ts
// apps/web/src/voice/filler-texts.ts
import {
  CUSTOMER_PREFERENCES_TOOL_NAME,
  LIST_CATEGORIES_TOOL_NAME,
  RUN_SQL_TOOL_NAME,
  SEARCH_KNOWLEDGE_TOOL_NAME,
} from 'core';

export const STILL_SEARCHING_TEXT = 'Még keresem, mindjárt mondom.';

const FILLER_BY_TOOL: Readonly<Record<string, string>> = {
  [RUN_SQL_TOOL_NAME]: 'Megnézem a katalógusban…',
  [SEARCH_KNOWLEDGE_TOOL_NAME]: 'Utánanézek a gondozási tudástárban…',
  [LIST_CATEGORIES_TOOL_NAME]: 'Megnézem, milyen kategóriáink vannak…',
  // Neutral: this tool does not only read.
  [CUSTOMER_PREFERENCES_TOOL_NAME]: 'Egy pillanat…',
};

export const ALL_FILLER_TEXTS: readonly string[] = [
  ...Object.values(FILLER_BY_TOOL),
  STILL_SEARCHING_TEXT,
];

export function fillerTextForTool(toolName: string): string | undefined {
  return FILLER_BY_TOOL[toolName];
}
```

```ts
// apps/web/src/voice/filler-cache.ts
//
// Pre-generated filler sentences, held in memory for the life of the server
// process. The key is model + voice + text, so changing the voice or the
// model never plays an old recording. Reads never wait: a filler that is
// not ready is simply skipped.

import { ALL_FILLER_TEXTS } from './filler-texts';

interface Entry {
  value?: Uint8Array;
  settled?: Promise<void>;
}

interface FillerKey {
  model: string;
  voice: string;
  text: string;
}

const entries = new Map<string, Entry>();

const keyOf = ({ model, voice, text }: FillerKey): string =>
  `${model}|${voice}|${text}`;

export interface WarmFillersInput {
  model: string;
  voice: string;
  synthesize: (text: string) => Promise<Uint8Array>;
  onFailure: (error: unknown) => void;
}

/** Starts generating every filler not yet cached; resolves when all settled. */
export async function warmFillers({
  model,
  voice,
  synthesize,
  onFailure,
}: WarmFillersInput): Promise<void> {
  const pending: Array<Promise<void>> = [];
  for (const text of ALL_FILLER_TEXTS) {
    const key = keyOf({ model, voice, text });
    const existing = entries.get(key);
    if (existing?.settled !== undefined) {
      pending.push(existing.settled);
      continue;
    }
    const entry: Entry = {};
    entry.settled = synthesize(text).then(
      (audio) => {
        entry.value = audio;
      },
      (error: unknown) => {
        entries.delete(key); // a later warm-up may retry
        onFailure(error);
      },
    );
    entries.set(key, entry);
    pending.push(entry.settled);
  }
  await Promise.all(pending);
}

export function getFillerIfReady(key: FillerKey): Uint8Array | undefined {
  return entries.get(keyOf(key))?.value;
}

export function clearFillerCache(): void {
  entries.clear();
}
```

- [ ] **Step 9: Run everything for the task**

Run: `pnpm nx run-many -t lint,typecheck,test -p web`
Expected: PASS. (Ha a `MockTranscriptionModelV2`/`doGenerate` visszatérési alakja a típusellenőrzésen elbukik, a `node_modules/.pnpm/@ai-sdk+provider@2.0.4/.../index.d.ts` `TranscriptionModelV2.doGenerate` leírásához igazítsd a teszt segédjét.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/voice/voice-config.ts apps/web/src/voice/voice-config.spec.ts apps/web/src/voice/transcription-fetch.ts apps/web/src/voice/transcription-fetch.spec.ts apps/web/src/voice/voice-providers.ts apps/web/src/voice/transcribe-audio.ts apps/web/src/voice/transcribe-audio.spec.ts apps/web/src/voice/synthesize-speech.ts apps/web/src/voice/speech-queue.ts apps/web/src/voice/speech-queue.spec.ts apps/web/src/voice/filler-texts.ts apps/web/src/voice/filler-cache.ts apps/web/src/voice/filler-cache.spec.ts apps/web/src/voice/safe-error-fields.ts apps/web/src/voice/safe-error-fields.spec.ts
git commit -m "feat(web): add the speech providers and the filler cache

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A forduló, a handler és a route-ok

**Files:**
- Create: `apps/web/src/voice/voice-turn.ts`, `voice-handler.ts`, `apps/web/src/app/api/voice/route.ts`, `apps/web/src/app/api/voice/warmup/route.ts`
- Test: `voice-turn.spec.ts`, `voice-handler.spec.ts` (az `apps/web/src/voice/` alatt)

**Interfaces:**
- Consumes: Task 2–3 összes exportja; `core`: `streamAskAgent`, `ESCALATE_PREFIX`, `logger`; `apps/web/src/chat/escalation.ts` `splitEscalation`.
- Produces:
  - `runVoiceTurn(input: RunVoiceTurnInput): Promise<void>` ahol `RunVoiceTurnInput = { deps: VoiceDeps; audio: Uint8Array; history: HistoryMessage[]; signal: AbortSignal; emit: (event: VoiceEvent) => void; now?: () => number }`
  - `STILL_SEARCHING_DELAY_MS = 5000`, `EMPTY_TRANSCRIPT_MESSAGE`, `GENERIC_ERROR_MESSAGE`
  - `handleVoiceRequest(request: Request, getDeps: () => VoiceDeps): Promise<Response>`
  - `POST` a két route-ban.

- [ ] **Step 1: Write the failing `voice-turn.spec.ts`**

A `core`-t a meglévő `route.spec.ts` mintájára csak a `streamAskAgent` ponton cseréljük; a `fullStream`-et egy aszinkron generátor adja.

```ts
import { streamAskAgent } from 'core';
import { MockSpeechModelV2, MockTranscriptionModelV2 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceEvent } from './voice-events';
import { clearFillerCache, warmFillers } from './filler-cache';
import { STILL_SEARCHING_TEXT } from './filler-texts';
import { runVoiceTurn, STILL_SEARCHING_DELAY_MS } from './voice-turn';
import type { VoiceDeps } from './voice-providers';

vi.mock('core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core')>()),
  streamAskAgent: vi.fn(),
}));

type Part =
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'error'; error: unknown }
  | { type: 'finish' };

function agentStreaming(parts: AsyncIterable<Part>) {
  vi.mocked(streamAskAgent).mockReturnValue({
    fullStream: parts,
  } as unknown as ReturnType<typeof streamAskAgent>);
}

async function* ofParts(...parts: Part[]): AsyncGenerator<Part> {
  for (const part of parts) {
    yield part;
  }
}

const text = (value: string): Part => ({ type: 'text-delta', id: 't', text: value });

function makeDeps(transcript = 'Milyen kaktuszaitok vannak?'): VoiceDeps {
  return {
    config: { apiKey: 'k', sttModel: 'gpt-transcribe', ttsModel: 'tts', voice: 'coral' },
    transcriptionModel: new MockTranscriptionModelV2({
      doGenerate: async () => ({
        text: transcript,
        segments: [],
        language: 'hu',
        durationInSeconds: 3,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      }),
    }),
    speechModel: new MockSpeechModelV2({
      doGenerate: async () => ({
        audio: new Uint8Array([1, 2, 3]),
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      }),
    }),
  };
}

async function runTurn(deps: VoiceDeps, history = [] as never[]) {
  const events: VoiceEvent[] = [];
  await runVoiceTurn({
    deps,
    audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    history,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  return events;
}

const types = (events: VoiceEvent[]) => events.map((e) => e.type);

beforeEach(() => {
  clearFillerCache();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(streamAskAgent).mockReset();
});

describe('runVoiceTurn', () => {
  it('should emit transcript, text, sentences, timing and done in order', async () => {
    agentStreaming(ofParts(text('Van néhány. '), text('Például a mamilláriák.'), { type: 'finish' }));

    const events = await runTurn(makeDeps());

    expect(types(events)).toEqual([
      'transcript',
      'text-delta',
      'text-delta',
      'sentence',
      'sentence',
      'timing',
      'done',
    ]);
    const sentences = events.filter((e) => e.type === 'sentence');
    expect(sentences.map((s) => s.index)).toEqual([0, 1]);
  });

  it('should ask the agent in voice mode with the history plus the transcript', async () => {
    agentStreaming(ofParts(text('Szia.'), { type: 'finish' }));

    await runTurn(makeDeps('És az pet-safe?'), [
      { role: 'user', content: 'Mutass kaktuszt' },
      { role: 'assistant', content: 'Itt egy.' },
    ] as never[]);

    const [messages, options] = vi.mocked(streamAskAgent).mock.calls[0]!;
    expect(options).toMatchObject({ mode: 'voice' });
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'És az pet-safe?' });
    expect(messages).toHaveLength(3);
  });

  it('should not call the agent or the TTS when the recording was silent', async () => {
    const events = await runTurn(makeDeps(''));

    expect(events).toEqual([
      { type: 'error', message: 'Nem hallottam semmit, próbáld újra.' },
    ]);
    expect(streamAskAgent).not.toHaveBeenCalled();
  });

  it('should mark an escalation, show the text without the prefix and not speak the prefix', async () => {
    agentStreaming(ofParts(text('[ESCAL'), text('ATE] Egy kollégánk jelentkezik.'), { type: 'finish' }));

    const events = await runTurn(makeDeps());

    expect(types(events)).toContain('escalated');
    const shown = events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('');
    expect(shown).toBe('Egy kollégánk jelentkezik.');
    const spoken = events.filter((e) => e.type === 'sentence').map((e) => e.text);
    expect(spoken).toEqual(['Egy kollégánk jelentkezik.']);
  });

  it('should speak markdown as plain text', async () => {
    agentStreaming(ofParts(text('**Monstera** a [legjobb](https://x.hu) választás.'), { type: 'finish' }));

    const events = await runTurn(makeDeps());

    const spoken = events.filter((e) => e.type === 'sentence').map((e) => e.text);
    expect(spoken).toEqual(['Monstera a legjobb választás.']);
  });

  it('should cap the spoken text and close with the short closing line', async () => {
    const long = `${'Ez egy hosszú mondat. '.repeat(80)}`;
    agentStreaming(ofParts(text(long), { type: 'finish' }));

    const events = await runTurn(makeDeps());

    const spoken = events.filter((e) => e.type === 'sentence').map((e) => e.text);
    expect(spoken.at(-1)).toBe('A többit leírva láthatod.');
    expect(spoken.join(' ').length).toBeLessThan(1300);
  });

  it('should play a ready filler when a tool call starts, and report the tool', async () => {
    await warmFillers({ model: 'tts', voice: 'coral', synthesize: async () => new Uint8Array([9]), onFailure: () => undefined });
    agentStreaming(
      ofParts(
        { type: 'tool-call', toolCallId: 'c1', toolName: 'runSql', input: {} },
        text('Kész.'),
        { type: 'finish' },
      ),
    );

    const events = await runTurn(makeDeps());

    expect(events.find((e) => e.type === 'tool')).toEqual({ type: 'tool', name: 'runSql' });
    expect(events.find((e) => e.type === 'filler')).toMatchObject({ text: 'Megnézem a katalógusban…' });
  });

  it('should skip the filler instead of waiting when it is not ready', async () => {
    agentStreaming(
      ofParts({ type: 'tool-call', toolCallId: 'c1', toolName: 'runSql', input: {} }, text('Kész.'), { type: 'finish' } as never),
    );

    const events = await runTurn(makeDeps());

    expect(types(events)).not.toContain('filler');
  });

  it('should play the "still searching" filler after 5 seconds without text', async () => {
    vi.useFakeTimers();
    await warmFillers({ model: 'tts', voice: 'coral', synthesize: async () => new Uint8Array([9]), onFailure: () => undefined });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* slow(): AsyncGenerator<Part> {
      yield { type: 'tool-call', toolCallId: 'c1', toolName: 'searchKnowledge', input: {} };
      await gate;
      yield text('Megvan.');
      yield { type: 'finish' };
    }
    agentStreaming(slow());
    const events: VoiceEvent[] = [];

    const turn = runVoiceTurn({
      deps: makeDeps(),
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      history: [],
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    });
    await vi.advanceTimersByTimeAsync(STILL_SEARCHING_DELAY_MS + 10);
    release();
    await vi.advanceTimersByTimeAsync(10);
    await turn;

    const fillers = events.filter((e) => e.type === 'filler').map((e) => e.text);
    expect(fillers).toEqual(['Utánanézek a gondozási tudástárban…', STILL_SEARCHING_TEXT]);
  });

  it('should emit an error event when the agent stream fails', async () => {
    agentStreaming(ofParts({ type: 'error', error: new Error('model down') }));

    await expect(runTurn(makeDeps())).rejects.toThrow('model down');
  });

  it('should report each interval in the timing event', async () => {
    agentStreaming(ofParts(text('Szia.'), { type: 'finish' }));

    const events = await runTurn(makeDeps());

    const timing = events.find((e) => e.type === 'timing');
    expect(timing).toMatchObject({ type: 'timing' });
    expect(timing && 'firstTokenMs' in timing && timing.firstTokenMs).not.toBeNull();
    expect(timing && 'firstSentenceMs' in timing && timing.firstSentenceMs).not.toBeNull();
  });
});
```

(A „agent stream fails” teszt a `runVoiceTurn` dobását várja; az `error` eseményt a handler adja a kivételből — a következő lépésben.)

- [ ] **Step 2: Run → FAIL** (`pnpm nx test web -- src/voice/voice-turn.spec.ts`: a `voice-turn` nem létezik).

- [ ] **Step 3: Write `voice-turn.ts`**

```ts
// apps/web/src/voice/voice-turn.ts
//
// One spoken turn: speech → text → ask-agent (voice mode) → sentences →
// speech, reported as VoiceEvents. No HTTP here (voice-handler.ts owns
// that), so the whole pipeline is testable with mocked models.

import { ESCALATE_PREFIX, logger, streamAskAgent } from 'core';
import { splitEscalation } from '../chat/escalation';
import { getFillerIfReady } from './filler-cache';
import { fillerTextForTool, STILL_SEARCHING_TEXT } from './filler-texts';
import {
  createSentenceSplitter,
  createSpokenBudget,
  stripMarkdown,
} from './spoken-text';
import { createSpeechQueue } from './speech-queue';
import { synthesizeSpeech } from './synthesize-speech';
import { transcribeAudio } from './transcribe-audio';
import type { VoiceEvent } from './voice-events';
import type { VoiceDeps } from './voice-providers';
import type { HistoryMessage } from './voice-request-schema';

export const STILL_SEARCHING_DELAY_MS = 5000;
export const EMPTY_TRANSCRIPT_MESSAGE = 'Nem hallottam semmit, próbáld újra.';
export const GENERIC_ERROR_MESSAGE =
  'Hiba történt a hangos válasz közben. Kérlek, próbáld újra.';

export interface RunVoiceTurnInput {
  deps: VoiceDeps;
  audio: Uint8Array;
  history: HistoryMessage[];
  signal: AbortSignal;
  emit: (event: VoiceEvent) => void;
  now?: () => number;
}

const toBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');

/** Rejects on failure (the handler maps it to an `error` event). */
export async function runVoiceTurn({
  deps,
  audio,
  history,
  signal,
  emit,
  now = () => performance.now(),
}: RunVoiceTurnInput): Promise<void> {
  const { config } = deps;
  const startedAt = now();
  const elapsed = (): number => Math.round(now() - startedAt);

  const transcript = await transcribeAudio({
    model: deps.transcriptionModel,
    modelId: config.sttModel,
    audio,
    signal,
  });
  const sttMs = elapsed();
  logger.info('api_voice.stt_done', { sttMs });

  if (transcript.text.trim() === '') {
    emit({ type: 'error', message: EMPTY_TRANSCRIPT_MESSAGE });
    return;
  }
  emit({ type: 'transcript', text: transcript.text, sttMs });

  let firstTokenMs: number | null = null;
  let firstSentenceMs: number | null = null;
  let hasText = false;
  let hasFillerPlayed = false;
  let isEscalatedSent = false;
  let rawText = '';
  let shownLength = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const synthesize = (text: string): Promise<Uint8Array> =>
    synthesizeSpeech({
      model: deps.speechModel,
      voice: config.voice,
      text,
      signal,
    });

  const queue = createSpeechQueue({
    synthesize,
    onSentence: (sentence) => {
      if (firstSentenceMs === null) {
        firstSentenceMs = elapsed();
        logger.info('api_voice.first_sentence', { firstSentenceMs });
      }
      emit({
        type: 'sentence',
        index: sentence.index,
        text: sentence.text,
        audio: toBase64(sentence.audio),
        ttsMs: sentence.ttsMs,
      });
    },
    now,
  });

  const splitter = createSentenceSplitter();
  const budget = createSpokenBudget();
  const speak = (sentence: string): void => {
    const clean = stripMarkdown(sentence);
    const spoken = clean === '' ? null : budget.take(clean);
    if (spoken !== null) {
      queue.enqueue(spoken);
    }
  };

  const playFiller = (text: string): void => {
    if (hasText || firstSentenceMs !== null) {
      return; // the answer itself has started; a filler would only delay it
    }
    const filler = getFillerIfReady({
      model: config.ttsModel,
      voice: config.voice,
      text,
    });
    if (filler !== undefined) {
      emit({ type: 'filler', text, audio: toBase64(filler) });
    }
  };

  try {
    const result = streamAskAgent(
      [...history, { role: 'user', content: transcript.text }],
      { mode: 'voice', abortSignal: signal, model: deps.askModel },
    );

    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        emit({ type: 'tool', name: part.toolName });
        const text = fillerTextForTool(part.toolName);
        if (text !== undefined && !hasFillerPlayed) {
          hasFillerPlayed = true;
          playFiller(text);
          refreshTimer = setTimeout(
            () => playFiller(STILL_SEARCHING_TEXT),
            STILL_SEARCHING_DELAY_MS,
          );
        }
      } else if (part.type === 'text-delta') {
        hasText = true;
        clearTimeout(refreshTimer);
        if (firstTokenMs === null) {
          firstTokenMs = elapsed();
          logger.info('api_voice.first_token', { firstTokenMs });
        }
        rawText += part.text;
        const view = splitEscalation(rawText, ESCALATE_PREFIX);
        if (view.isEscalated && !isEscalatedSent) {
          isEscalatedSent = true;
          emit({ type: 'escalated' });
        }
        const delta = view.text.slice(shownLength);
        shownLength = view.text.length;
        if (delta !== '') {
          emit({ type: 'text-delta', text: delta });
          splitter.push(delta).forEach(speak);
        }
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
    splitter.flush().forEach(speak);
    await queue.finish();
  } finally {
    clearTimeout(refreshTimer);
  }

  const totalMs = elapsed();
  logger.info('api_voice.completed', { totalMs });
  emit({ type: 'timing', sttMs, firstTokenMs, firstSentenceMs, totalMs });
  emit({ type: 'done' });
}
```

(A `voice-turn.ts`-be ne importáld a `safe-error-fields`-et: a hibanaplózás a handler dolga.) Az `askModel: undefined` a `streamAskAgent` opciójában az alapértelmezett Anthropic-modellt jelenti, ez szándékos.

- [ ] **Step 4: Run → PASS** (`pnpm nx test web -- src/voice/voice-turn.spec.ts`).

- [ ] **Step 5: Write the failing `voice-handler.spec.ts`**

```ts
import { streamAskAgent } from 'core';
import { MockSpeechModelV2, MockTranscriptionModelV2 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFillerCache } from './filler-cache';
import { handleVoiceRequest } from './voice-handler';
import { VoiceNotConfiguredError } from './voice-config';
import type { VoiceDeps } from './voice-providers';

vi.mock('server-only', () => ({}));
vi.mock('core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core')>()),
  streamAskAgent: vi.fn(),
}));

/** Distinctive user speech that must never appear in the ops log. */
const SECRET_TEXT = 'TITKOS-ATIRAT-4711';

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  clearFillerCache();
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(streamAskAgent).mockReset();
});

function deps(overrides: { speechFails?: boolean; transcript?: string } = {}): VoiceDeps {
  return {
    config: { apiKey: 'k', sttModel: 'gpt-transcribe', ttsModel: 'tts', voice: 'coral' },
    transcriptionModel: new MockTranscriptionModelV2({
      doGenerate: async () => ({
        text: overrides.transcript ?? SECRET_TEXT,
        segments: [],
        language: 'hu',
        durationInSeconds: 2,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      }),
    }),
    speechModel: new MockSpeechModelV2({
      doGenerate: async () => {
        if (overrides.speechFails) {
          throw Object.assign(new Error(`tts failed for ${SECRET_TEXT}`), {
            name: 'AI_APICallError',
            statusCode: 500,
          });
        }
        return {
          audio: new Uint8Array([1, 2, 3]),
          warnings: [],
          response: { timestamp: new Date(), modelId: 'mock', headers: {} },
        };
      },
    }),
  };
}

function agentSaying(...texts: string[]) {
  async function* parts() {
    for (const text of texts) {
      yield { type: 'text-delta' as const, id: 't', text };
    }
    yield { type: 'finish' as const };
  }
  vi.mocked(streamAskAgent).mockReturnValue({
    fullStream: parts(),
  } as unknown as ReturnType<typeof streamAskAgent>);
}

function post(fields: Record<string, string | Blob>, signal?: AbortSignal): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request('http://localhost/api/voice', { method: 'POST', body: form, signal });
}

const webm = () => new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0])], { type: 'audio/webm;codecs=opus' });

async function eventsOf(response: Response): Promise<Array<{ type: string; message?: string }>> {
  const body = await response.text();
  return body.trim().split('\n').map((line) => JSON.parse(line));
}

describe('POST /api/voice (handler)', () => {
  it('should stream NDJSON events for a valid request', async () => {
    agentSaying('Van néhány kaktuszunk.');

    const response = await handleVoiceRequest(post({ audio: webm() }), () => deps());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await eventsOf(response);
    expect(events.map((e) => e.type)).toEqual(['transcript', 'text-delta', 'sentence', 'timing', 'done']);
  });

  it.each([
    ['an unknown form field', { audio: webm(), extra: 'x' }],
    ['a missing audio', {}],
    ['a text/html upload', { audio: new Blob(['x'], { type: 'text/html' }) }],
    ['an oversized upload', { audio: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'audio/webm' }) }],
  ])('should answer 400 for %s', async (_name, fields) => {
    const response = await handleVoiceRequest(post(fields), () => deps());

    expect(response.status).toBe(400);
    expect(streamAskAgent).not.toHaveBeenCalled();
  });

  it('should answer 400 for a body that is not a form', async () => {
    const response = await handleVoiceRequest(
      new Request('http://localhost/api/voice', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      () => deps(),
    );

    expect(response.status).toBe(400);
  });

  it('should answer 503 with a Hungarian message when the API key is missing', async () => {
    const response = await handleVoiceRequest(post({ audio: webm() }), () => {
      throw new VoiceNotConfiguredError();
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'A hangfunkció nincs beállítva (hiányzik az OPENAI_API_KEY).',
    });
  });

  it('should send an error event and log only name and status when the TTS fails', async () => {
    agentSaying('Valami.');

    const response = await handleVoiceRequest(post({ audio: webm() }), () => deps({ speechFails: true }));
    const events = await eventsOf(response);

    const error = events.find((e) => e.type === 'error');
    expect(error?.message).toBe('Hiba történt a hangos válasz közben. Kérlek, próbáld újra.');
    const logged = [...stdout, ...stderr].join('');
    expect(logged).toContain('api_voice.failed');
    expect(logged).toContain('AI_APICallError');
    expect(logged).not.toContain(SECRET_TEXT);
  });

  it('should never put the transcript or the answer into the ops log', async () => {
    agentSaying('Ez a válasz sem kerülhet a naplóba.');

    const response = await handleVoiceRequest(post({ audio: webm() }), () => deps());
    await response.text();

    const logged = [...stdout, ...stderr].join('');
    expect(logged).toContain('api_voice.completed');
    expect(logged).not.toContain(SECRET_TEXT);
    expect(logged).not.toContain('Ez a válasz');
  });

  it('should log an abort quietly and send no error event', async () => {
    const controller = new AbortController();
    async function* parts() {
      yield { type: 'text-delta' as const, id: 't', text: 'Elkezdem. ' };
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: 'text-delta' as const, id: 't', text: 'Folytatom. ' };
    }
    vi.mocked(streamAskAgent).mockReturnValue({ fullStream: parts() } as unknown as ReturnType<typeof streamAskAgent>);

    const response = await handleVoiceRequest(post({ audio: webm() }, controller.signal), () => deps());
    const events = await eventsOf(response).catch(() => []);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect([...stdout, ...stderr].join('')).toContain('api_voice.aborted');
  });
});
```

- [ ] **Step 6: Run → FAIL, then write `voice-handler.ts`**

```ts
// apps/web/src/voice/voice-handler.ts
//
// The HTTP layer of POST /api/voice: validate, then stream the turn as
// NDJSON. `getDeps` is a seam so tests (and the route) decide how the
// providers are built; it throws VoiceNotConfiguredError without a key.

import { logger } from 'core';
import { safeErrorFields } from './safe-error-fields';
import { NOT_CONFIGURED_MESSAGE, VoiceNotConfiguredError } from './voice-config';
import type { VoiceEvent } from './voice-events';
import type { VoiceDeps } from './voice-providers';
import { parseVoiceRequest, VoiceRequestError } from './voice-request-schema';
import { GENERIC_ERROR_MESSAGE, runVoiceTurn } from './voice-turn';

const INVALID_REQUEST_MESSAGE = 'Érvénytelen kérés.';

export async function handleVoiceRequest(
  request: Request,
  getDeps: () => VoiceDeps,
): Promise<Response> {
  let deps: VoiceDeps;
  try {
    deps = getDeps();
  } catch (error: unknown) {
    if (error instanceof VoiceNotConfiguredError) {
      logger.error('api_voice.not_configured');
      return Response.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
    }
    throw error;
  }

  let parsed: Awaited<ReturnType<typeof parseVoiceRequest>>;
  try {
    parsed = await parseVoiceRequest(await request.formData());
  } catch (error: unknown) {
    // Neither the form parser's nor our message quotes the input.
    logger.error('api_voice.invalid_request', safeErrorFields(error));
    return Response.json({ error: INVALID_REQUEST_MESSAGE }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: VoiceEvent): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // the client is gone (stream closed); nothing left to tell it
        }
      };
      try {
        await runVoiceTurn({
          deps,
          audio: parsed.audio,
          history: parsed.history,
          signal: request.signal,
          emit,
        });
      } catch (error: unknown) {
        if (request.signal.aborted) {
          logger.info('api_voice.aborted');
        } else if (error instanceof VoiceRequestError) {
          logger.warn('api_voice.rejected', safeErrorFields(error));
          emit({ type: 'error', message: error.message });
        } else {
          logger.error('api_voice.failed', safeErrorFields(error));
          emit({ type: 'error', message: GENERIC_ERROR_MESSAGE });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client's cancel
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
```

A handler a `transcribeAudio` által dobott `VoiceRequestError`-t (túl hosszú felvétel, magyar üzenettel) `error` eseményként küldi tovább; a `VoiceRequestError` üzenetei a `transcribe-audio.ts`-ben magyarok, mert ezek a felhasználónak szólnak (a `voice-request-schema.ts` üzenetei csak naplóba/400-ba mennek, ott nem jelennek meg).

- [ ] **Step 7: Write the routes**

```ts
// apps/web/src/app/api/voice/route.ts
import 'server-only';
import { handleVoiceRequest } from '../../../voice/voice-handler';
import { readVoiceConfig } from '../../../voice/voice-config';
import { createVoiceDeps } from '../../../voice/voice-providers';

// The voice pipeline needs Node (Buffer, the ask-agent's pg and fs logging).
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return handleVoiceRequest(request, () => createVoiceDeps(readVoiceConfig()));
}
```

```ts
// apps/web/src/app/api/voice/warmup/route.ts
import 'server-only';
import { logger } from 'core';
import { NOT_CONFIGURED_MESSAGE, readVoiceConfig, VoiceNotConfiguredError } from '../../../../voice/voice-config';
import { warmFillers } from '../../../../voice/filler-cache';
import { safeErrorFields } from '../../../../voice/safe-error-fields';
import { synthesizeSpeech } from '../../../../voice/synthesize-speech';
import { createVoiceDeps } from '../../../../voice/voice-providers';

export const runtime = 'nodejs';

/** Starts generating the filler sentences in the background; answers at once. */
export function POST(): Response {
  let deps: ReturnType<typeof createVoiceDeps>;
  try {
    deps = createVoiceDeps(readVoiceConfig());
  } catch (error: unknown) {
    if (error instanceof VoiceNotConfiguredError) {
      logger.error('api_voice.not_configured');
      return Response.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
    }
    throw error;
  }
  const idle = new AbortController().signal;
  void warmFillers({
    model: deps.config.ttsModel,
    voice: deps.config.voice,
    synthesize: (text) =>
      synthesizeSpeech({ model: deps.speechModel, voice: deps.config.voice, text, signal: idle }),
    onFailure: (error) => logger.warn('api_voice.filler_warm_failed', safeErrorFields(error)),
  });
  return Response.json({ status: 'warming' }, { status: 202 });
}
```

A warmup route-hoz is írj egy rövid tesztet `warmup/route.spec.ts`-ben: hiányzó kulcsnál `503` (`vi.stubEnv('OPENAI_API_KEY', '')`), megadott kulcsnál `202` — a `synthesizeSpeech`-et `vi.mock('../../../../voice/synthesize-speech')`-sel cseréld, hogy ne legyen hálózati hívás; `vi.mock('server-only', () => ({}))` kell.

- [ ] **Step 8: Run everything**

Run: `pnpm nx run-many -t lint,typecheck,test -p web core`
Expected: PASS — benne a chat `route.spec.ts` és a core toolkészlet-tesztek változatlanul.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/voice/voice-turn.ts apps/web/src/voice/voice-turn.spec.ts apps/web/src/voice/voice-handler.ts apps/web/src/voice/voice-handler.spec.ts apps/web/src/app/api/voice/route.ts apps/web/src/app/api/voice/warmup/route.ts apps/web/src/app/api/voice/warmup/route.spec.ts apps/web/src/voice/transcribe-audio.ts
git commit -m "feat(web): add the /api/voice and warmup routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Kliens tiszta logika — parser, állapot, állapotgép, formátum, hangsor

**Files:**
- Create: `ndjson-parser.ts`, `voice-state.ts`, `push-to-talk-machine.ts`, `recording-format.ts`, `audio-queue.ts` (mind `apps/web/src/voice/`)
- Test: mellettük `*.spec.ts`

**Interfaces:**
- Consumes: `VoiceEvent`, `isVoiceEvent` (Task 2).
- Produces:
  - `createNdjsonParser(): { push(chunk: string): VoiceEvent[] }`
  - `interface VoiceTurn`, `interface VoiceState`, `type VoiceAction`, `voiceReducer(state, action)`, `initialVoiceState`, `historyFor(state, escalatePrefix): HistoryMessage[]`, `lastTurn(state): VoiceTurn | undefined`
  - `nextPttPhase(phase, event): { phase: PttPhase; action: 'start' | 'stop' | null }`, `type PttPhase = 'idle' | 'recording'`, `type PttEvent = 'press' | 'release' | 'timeout' | 'cancel'`
  - `pickRecordingMimeType(isSupported: (type: string) => boolean): string | null`, `isEditableTarget(target: EventTarget | null): boolean`, `MAX_RECORDING_MS = 30_000`
  - `createAudioQueue(options): AudioQueue` ahol `AudioQueue = { enqueue(audioBase64: string, kind: 'filler' | 'sentence'): void; stop(): void }`, `options = { createAudio?: (src: string) => PlayableAudio; onFirstPlay?: (kind) => void; onIdle?: () => void }`

- [ ] **Step 1: Write the failing `ndjson-parser.spec.ts`, then `ndjson-parser.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createNdjsonParser } from './ndjson-parser';

describe('createNdjsonParser', () => {
  it('should parse complete lines', () => {
    const parser = createNdjsonParser();

    expect(parser.push('{"type":"done"}\n{"type":"escalated"}\n')).toEqual([
      { type: 'done' },
      { type: 'escalated' },
    ]);
  });

  it('should hold a line split across chunks until it is complete', () => {
    const parser = createNdjsonParser();

    expect(parser.push('{"type":"tran')).toEqual([]);
    expect(parser.push('script","text":"szia","sttMs":5}\n')).toEqual([
      { type: 'transcript', text: 'szia', sttMs: 5 },
    ]);
  });

  it('should skip blank lines, malformed JSON and unknown event types', () => {
    const parser = createNdjsonParser();

    expect(parser.push('\nnot json\n{"type":"nope"}\n{"type":"done"}\n')).toEqual([
      { type: 'done' },
    ]);
  });
});
```

```ts
// apps/web/src/voice/ndjson-parser.ts
import { isVoiceEvent, type VoiceEvent } from './voice-events';

export interface NdjsonParser {
  push(chunk: string): VoiceEvent[];
}

/** Incremental NDJSON → VoiceEvent parser; tolerates lines split across chunks. */
export function createNdjsonParser(): NdjsonParser {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      const events: VoiceEvent[] = [];
      for (const line of lines) {
        if (line.trim() === '') {
          continue;
        }
        try {
          const value: unknown = JSON.parse(line);
          if (isVoiceEvent(value)) {
            events.push(value);
          }
        } catch {
          // a malformed line is dropped; the stream goes on
        }
      }
      return events;
    },
  };
}
```

- [ ] **Step 2: Write the failing `voice-state.spec.ts`, then `voice-state.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { historyFor, initialVoiceState, lastTurn, voiceReducer, type VoiceAction } from './voice-state';

const PREFIX = '[ESCALATE] ';

function run(...actions: VoiceAction[]) {
  return actions.reduce(voiceReducer, initialVoiceState);
}

const started: VoiceAction = { type: 'turn-started' };
const event = (e: Extract<VoiceAction, { type: 'event' }>['event']): VoiceAction => ({ type: 'event', event: e });

describe('voiceReducer', () => {
  it('should start a transcribing turn', () => {
    expect(lastTurn(run(started))?.status).toBe('transcribing');
  });

  it('should collect the transcript, text, tools and sentences of a turn', () => {
    const turn = lastTurn(
      run(
        started,
        event({ type: 'transcript', text: 'Szia', sttMs: 300 }),
        event({ type: 'tool', name: 'runSql' }),
        event({ type: 'text-delta', text: 'Van ' }),
        event({ type: 'text-delta', text: 'egy.' }),
      ),
    );

    expect(turn).toMatchObject({
      transcript: 'Szia',
      tools: ['runSql'],
      text: 'Van egy.',
      status: 'answering',
    });
  });

  it('should keep the server timing and finish on done', () => {
    const turn = lastTurn(
      run(
        started,
        event({ type: 'timing', sttMs: 300, firstTokenMs: 900, firstSentenceMs: 1100, totalMs: 2000 }),
        event({ type: 'done' }),
      ),
    );

    expect(turn?.server).toEqual({ sttMs: 300, firstTokenMs: 900, firstSentenceMs: 1100, totalMs: 2000 });
    expect(turn?.status).toBe('done');
  });

  it('should record the first sound only once', () => {
    const turn = lastTurn(run(started, { type: 'first-sound', ms: 700 }, { type: 'first-sound', ms: 900 }));

    expect(turn?.firstSoundMs).toBe(700);
  });

  it('should mark the escalation', () => {
    expect(lastTurn(run(started, event({ type: 'escalated' })))?.isEscalated).toBe(true);
  });

  it('should fail a turn on an error event and on a client failure', () => {
    expect(lastTurn(run(started, event({ type: 'error', message: 'Baj.' })))).toMatchObject({
      status: 'error',
      error: 'Baj.',
    });
    expect(lastTurn(run(started, { type: 'failed', message: 'Nincs hálózat.' }))?.error).toBe('Nincs hálózat.');
  });

  it('should abort only a turn that is still in progress', () => {
    expect(lastTurn(run(started, { type: 'aborted' }))?.status).toBe('aborted');
    expect(lastTurn(run(started, event({ type: 'done' }), { type: 'aborted' }))?.status).toBe('done');
  });
});

describe('historyFor', () => {
  it('should return the finished turns as user/assistant pairs, keeping the escalation prefix', () => {
    const state = run(
      started,
      event({ type: 'transcript', text: 'Hol a rendelésem?', sttMs: 1 }),
      event({ type: 'escalated' }),
      event({ type: 'text-delta', text: 'Kolléga jelentkezik.' }),
      event({ type: 'done' }),
    );

    expect(historyFor(state, PREFIX)).toEqual([
      { role: 'user', content: 'Hol a rendelésem?' },
      { role: 'assistant', content: '[ESCALATE] Kolléga jelentkezik.' },
    ]);
  });

  it('should leave out aborted, failed and unfinished turns', () => {
    const state = run(started, event({ type: 'transcript', text: 'x', sttMs: 1 }), { type: 'aborted' }, started);

    expect(historyFor(state, PREFIX)).toEqual([]);
  });

  it('should keep at most the last 20 messages', () => {
    const finished = (n: number): VoiceAction[] => [
      started,
      event({ type: 'transcript', text: `k${n}`, sttMs: 1 }),
      event({ type: 'text-delta', text: `v${n}` }),
      event({ type: 'done' }),
    ];
    const state = run(...Array.from({ length: 12 }, (_, n) => finished(n)).flat());

    const history = historyFor(state, PREFIX);

    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', content: 'k2' });
  });
});
```

```ts
// apps/web/src/voice/voice-state.ts
import type { VoiceEvent } from './voice-events';
import type { HistoryMessage } from './voice-request-schema';

export type TurnStatus = 'transcribing' | 'answering' | 'done' | 'error' | 'aborted';

export interface ServerTiming {
  sttMs: number;
  firstTokenMs: number | null;
  firstSentenceMs: number | null;
  totalMs: number;
}

export interface VoiceTurn {
  id: number;
  status: TurnStatus;
  transcript: string | null;
  /** The answer as shown: without the escalation prefix. */
  text: string;
  tools: string[];
  isEscalated: boolean;
  server: ServerTiming | null;
  /** Release of the button → first audible output (client-side). */
  firstSoundMs: number | null;
  error: string | null;
}

export interface VoiceState {
  turns: VoiceTurn[];
}

export type VoiceAction =
  | { type: 'turn-started' }
  | { type: 'event'; event: VoiceEvent }
  | { type: 'first-sound'; ms: number }
  | { type: 'aborted' }
  | { type: 'failed'; message: string };

export const initialVoiceState: VoiceState = { turns: [] };

const MAX_HISTORY_MESSAGES = 20;

export function lastTurn(state: VoiceState): VoiceTurn | undefined {
  return state.turns.at(-1);
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  if (action.type === 'turn-started') {
    const turn: VoiceTurn = {
      id: state.turns.length,
      status: 'transcribing',
      transcript: null,
      text: '',
      tools: [],
      isEscalated: false,
      server: null,
      firstSoundMs: null,
      error: null,
    };
    return { turns: [...state.turns, turn] };
  }
  const current = lastTurn(state);
  if (current === undefined) {
    return state;
  }
  return { turns: [...state.turns.slice(0, -1), reduceTurn(current, action)] };
}

function reduceTurn(turn: VoiceTurn, action: VoiceAction): VoiceTurn {
  switch (action.type) {
    case 'first-sound':
      return turn.firstSoundMs === null ? { ...turn, firstSoundMs: action.ms } : turn;
    case 'aborted':
      return isInProgress(turn) ? { ...turn, status: 'aborted' } : turn;
    case 'failed':
      return { ...turn, status: 'error', error: action.message };
    case 'event':
      return reduceEvent(turn, action.event);
    default:
      return turn;
  }
}

function reduceEvent(turn: VoiceTurn, event: VoiceEvent): VoiceTurn {
  switch (event.type) {
    case 'transcript':
      return { ...turn, transcript: event.text, status: 'answering' };
    case 'tool':
      return { ...turn, tools: [...turn.tools, event.name] };
    case 'text-delta':
      return { ...turn, text: turn.text + event.text };
    case 'escalated':
      return { ...turn, isEscalated: true };
    case 'timing':
      return {
        ...turn,
        server: {
          sttMs: event.sttMs,
          firstTokenMs: event.firstTokenMs,
          firstSentenceMs: event.firstSentenceMs,
          totalMs: event.totalMs,
        },
      };
    case 'done':
      return { ...turn, status: 'done' };
    case 'error':
      return { ...turn, status: 'error', error: event.message };
    default:
      return turn; // filler, sentence: audio only, handled by the audio queue
  }
}

const isInProgress = (turn: VoiceTurn): boolean =>
  turn.status === 'transcribing' || turn.status === 'answering';

/** Finished turns as conversation history, the model's own wording preserved. */
export function historyFor(state: VoiceState, escalatePrefix: string): HistoryMessage[] {
  const messages = state.turns.flatMap((turn): HistoryMessage[] => {
    if (turn.status !== 'done' || turn.transcript === null || turn.text === '') {
      return [];
    }
    return [
      { role: 'user', content: turn.transcript },
      { role: 'assistant', content: (turn.isEscalated ? escalatePrefix : '') + turn.text },
    ];
  });
  return messages.slice(-MAX_HISTORY_MESSAGES);
}
```

- [ ] **Step 3: Write the failing `push-to-talk-machine.spec.ts` and `recording-format.spec.ts`, then implement**

```ts
import { describe, expect, it } from 'vitest';
import { nextPttPhase } from './push-to-talk-machine';

describe('nextPttPhase', () => {
  it('should start recording on the first press', () => {
    expect(nextPttPhase('idle', 'press')).toEqual({ phase: 'recording', action: 'start' });
  });

  it('should ignore a second press while recording (key repeat, double trigger)', () => {
    expect(nextPttPhase('recording', 'press')).toEqual({ phase: 'recording', action: null });
  });

  it.each(['release', 'timeout'] as const)('should stop on %s', (event) => {
    expect(nextPttPhase('recording', event)).toEqual({ phase: 'idle', action: 'stop' });
  });

  it('should discard the recording on cancel', () => {
    expect(nextPttPhase('recording', 'cancel')).toEqual({ phase: 'idle', action: 'discard' });
  });

  it.each(['release', 'timeout', 'cancel'] as const)('should ignore %s while idle', (event) => {
    expect(nextPttPhase('idle', event)).toEqual({ phase: 'idle', action: null });
  });
});
```

```ts
// apps/web/src/voice/push-to-talk-machine.ts
export type PttPhase = 'idle' | 'recording';
export type PttEvent = 'press' | 'release' | 'timeout' | 'cancel';
export type PttAction = 'start' | 'stop' | 'discard' | null;

/** The press-and-hold state machine; keeps double triggers from double recording. */
export function nextPttPhase(
  phase: PttPhase,
  event: PttEvent,
): { phase: PttPhase; action: PttAction } {
  if (phase === 'idle') {
    return event === 'press'
      ? { phase: 'recording', action: 'start' }
      : { phase: 'idle', action: null };
  }
  switch (event) {
    case 'press':
      return { phase: 'recording', action: null };
    case 'cancel':
      return { phase: 'idle', action: 'discard' };
    default:
      return { phase: 'idle', action: 'stop' };
  }
}
```

(A spec 3. sora: `action` típusa bővült `'discard'`-dal — a „Produces” fejléc ennek megfelelően értendő.)

```ts
import { describe, expect, it } from 'vitest';
import { isEditableTarget, pickRecordingMimeType } from './recording-format';

describe('pickRecordingMimeType', () => {
  it('should prefer webm/opus', () => {
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('should fall back to mp4 (Safari)', () => {
    expect(pickRecordingMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('should return null when nothing the server accepts is supported', () => {
    expect(pickRecordingMimeType(() => false)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it.each(['input', 'textarea', 'select'])('should treat <%s> as editable', (tagName) => {
    expect(isEditableTarget({ tagName: tagName.toUpperCase(), isContentEditable: false } as unknown as EventTarget)).toBe(true);
  });

  it('should treat contenteditable as editable', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('should not treat a button or the body as editable', () => {
    expect(isEditableTarget({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
```

```ts
// apps/web/src/voice/recording-format.ts

/** The client stops recording here; the server checks the same limit. */
export const MAX_RECORDING_MS = 30_000;

// The server accepts webm and mp4; Firefox's default (ogg) is not on the
// transcription model's list, so only these two are ever requested.
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export function pickRecordingMimeType(
  isSupported: (type: string) => boolean,
): string | null {
  return PREFERRED_TYPES.find((type) => isSupported(type)) ?? null;
}

/** The space bar must keep typing in fields, only elsewhere it talks. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !('tagName' in target)) {
    return false;
  }
  const { tagName, isContentEditable } = target as {
    tagName: string;
    isContentEditable?: boolean;
  };
  return (
    isContentEditable === true ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}
```

- [ ] **Step 4: Write the failing `audio-queue.spec.ts`, then `audio-queue.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAudioQueue, type PlayableAudio } from './audio-queue';

class FakeAudio implements PlayableAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  played = false;
  paused = false;
  constructor(readonly src: string) {}
  play(): Promise<void> {
    this.played = true;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  finish(): void {
    this.onended?.();
  }
}

function setup() {
  const created: FakeAudio[] = [];
  const onFirstPlay = vi.fn();
  const onIdle = vi.fn();
  const queue = createAudioQueue({
    createAudio: (src) => {
      const audio = new FakeAudio(src);
      created.push(audio);
      return audio;
    },
    onFirstPlay,
    onIdle,
  });
  return { queue, created, onFirstPlay, onIdle };
}

describe('createAudioQueue', () => {
  it('should play items one after the other', () => {
    const { queue, created } = setup();

    queue.enqueue('A', 'sentence');
    queue.enqueue('B', 'sentence');

    expect(created.map((a) => a.src)).toEqual(['data:audio/mpeg;base64,A']);
    created[0]?.finish();
    expect(created.map((a) => a.src)).toEqual([
      'data:audio/mpeg;base64,A',
      'data:audio/mpeg;base64,B',
    ]);
  });

  it('should report the first playback of a turn once', () => {
    const { queue, created, onFirstPlay } = setup();

    queue.enqueue('A', 'filler');
    created[0]?.finish();
    queue.enqueue('B', 'sentence');

    expect(onFirstPlay).toHaveBeenCalledTimes(1);
    expect(onFirstPlay).toHaveBeenCalledWith('filler');
  });

  it('should drop a waiting filler once a sentence arrived', () => {
    const { queue, created } = setup();

    queue.enqueue('S0', 'sentence');
    queue.enqueue('F', 'filler');
    created[0]?.finish();

    expect(created).toHaveLength(1);
  });

  it('should ignore a filler that arrives after a sentence', () => {
    const { queue, created } = setup();

    queue.enqueue('S0', 'sentence');
    created[0]?.finish();
    queue.enqueue('F', 'filler');

    expect(created).toHaveLength(1);
  });

  it('should not cut off a filler that is already playing when a sentence arrives', () => {
    const { queue, created } = setup();

    queue.enqueue('F', 'filler');
    queue.enqueue('S0', 'sentence');

    expect(created[0]?.paused).toBe(false);
    created[0]?.finish();
    expect(created.map((a) => a.src)).toEqual([
      'data:audio/mpeg;base64,F',
      'data:audio/mpeg;base64,S0',
    ]);
  });

  it('should stop the current audio, empty the queue and forget the turn on stop()', () => {
    const { queue, created, onFirstPlay } = setup();

    queue.enqueue('A', 'sentence');
    queue.enqueue('B', 'sentence');
    queue.stop();
    created[0]?.finish(); // a late ended event must not start B

    expect(created[0]?.paused).toBe(true);
    expect(created).toHaveLength(1);

    queue.enqueue('C', 'filler');
    expect(created).toHaveLength(2);
    expect(onFirstPlay).toHaveBeenCalledTimes(2);
  });

  it('should call onIdle when the queue runs dry', () => {
    const { queue, created, onIdle } = setup();

    queue.enqueue('A', 'sentence');
    created[0]?.finish();

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('should move on when playback is rejected (autoplay policy)', async () => {
    const created: FakeAudio[] = [];
    const queue = createAudioQueue({
      createAudio: (src) => {
        const audio = new FakeAudio(src);
        audio.play = () => Promise.reject(new Error('NotAllowedError'));
        created.push(audio);
        return audio;
      },
    });

    queue.enqueue('A', 'sentence');
    queue.enqueue('B', 'sentence');
    await Promise.resolve();
    await Promise.resolve();

    expect(created).toHaveLength(2);
  });
});
```

```ts
// apps/web/src/voice/audio-queue.ts
//
// Plays the answer's mp3 pieces one after the other. A filler is only for
// bridging silence, so it never plays once a sentence of the answer exists.

export interface PlayableAudio {
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

export type AudioKind = 'filler' | 'sentence';

export interface AudioQueueOptions {
  createAudio?: (src: string) => PlayableAudio;
  /** The first audible output of a turn (a filler counts). */
  onFirstPlay?: (kind: AudioKind) => void;
  onIdle?: () => void;
}

export interface AudioQueue {
  enqueue(audioBase64: string, kind: AudioKind): void;
  /** Barge-in: silences at once and forgets the turn. */
  stop(): void;
}

interface Item {
  src: string;
  kind: AudioKind;
}

export function createAudioQueue({
  createAudio = (src) => new Audio(src),
  onFirstPlay,
  onIdle,
}: AudioQueueOptions = {}): AudioQueue {
  let pending: Item[] = [];
  let current: PlayableAudio | null = null;
  let hasSentence = false;
  let hasPlayed = false;
  let generation = 0;

  const playNext = (): void => {
    if (current !== null) {
      return;
    }
    const item = pending.shift();
    if (item === undefined) {
      onIdle?.();
      return;
    }
    const audio = createAudio(item.src);
    const myGeneration = generation;
    current = audio;
    const advance = (): void => {
      if (generation !== myGeneration || current !== audio) {
        return; // a stop() happened; this audio belongs to a dead turn
      }
      current = null;
      playNext();
    };
    audio.onended = advance;
    audio.onerror = advance;
    if (!hasPlayed) {
      hasPlayed = true;
      onFirstPlay?.(item.kind);
    }
    audio.play().catch(advance);
  };

  return {
    enqueue(audioBase64, kind) {
      if (kind === 'filler' && hasSentence) {
        return;
      }
      if (kind === 'sentence') {
        hasSentence = true;
        pending = pending.filter((item) => item.kind === 'sentence');
      }
      pending.push({ src: `data:audio/mpeg;base64,${audioBase64}`, kind });
      playNext();
    },
    stop() {
      generation += 1;
      pending = [];
      hasSentence = false;
      hasPlayed = false;
      const audio = current;
      current = null;
      audio?.pause();
    },
  };
}
```

- [ ] **Step 5: Run everything and commit**

Run: `pnpm nx run-many -t lint,typecheck,test -p web`
Expected: PASS.

```bash
git add apps/web/src/voice/ndjson-parser.ts apps/web/src/voice/ndjson-parser.spec.ts apps/web/src/voice/voice-state.ts apps/web/src/voice/voice-state.spec.ts apps/web/src/voice/push-to-talk-machine.ts apps/web/src/voice/push-to-talk-machine.spec.ts apps/web/src/voice/recording-format.ts apps/web/src/voice/recording-format.spec.ts apps/web/src/voice/audio-queue.ts apps/web/src/voice/audio-queue.spec.ts
git commit -m "feat(web): add the voice client logic

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Kliens felület — hívás, hook, waterfall, panel, oldal

**Files:**
- Create: `voice-client.ts`, `use-push-to-talk.ts`, `waterfall-panel.tsx`, `voice-panel.tsx`, `voice.module.css` (`apps/web/src/voice/`), `apps/web/src/app/voice/page.tsx`
- Modify: `apps/web/src/app/page.tsx` (link a /voice-ra)
- Test: `waterfall-panel.spec.tsx`, `voice-panel.spec.tsx`

**Interfaces:**
- Consumes: Task 5 összes exportja; `timingTone`; `splitEscalation` nem kell (a szerver már lehámozva küldi).
- Produces: `streamVoiceTurn({ audio, history, signal, onEvent }): Promise<void>`; `usePushToTalk(options)`; `<WaterfallPanel turn={VoiceTurn} />`; `<VoicePanel escalatePrefix={string} />`.

- [ ] **Step 1: Write the failing `waterfall-panel.spec.tsx`**

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VoiceTurn } from './voice-state';
import { WaterfallPanel } from './waterfall-panel';

const base: VoiceTurn = {
  id: 0,
  status: 'done',
  transcript: 'Milyen kaktuszaitok vannak?',
  text: 'Van néhány.',
  tools: ['runSql'],
  isEscalated: false,
  server: { sttMs: 500, firstTokenMs: 1200, firstSentenceMs: 1700, totalMs: 3000 },
  firstSoundMs: 2000,
  error: null,
};

function html(turn: VoiceTurn): string {
  return renderToStaticMarkup(<WaterfallPanel turn={turn} />);
}

describe('WaterfallPanel', () => {
  it('should show the transcript, the answer and the tool step', () => {
    const markup = html(base);

    expect(markup).toContain('Milyen kaktuszaitok vannak?');
    expect(markup).toContain('Van néhány.');
    expect(markup).toContain('runSql');
  });

  it('should color each metric by the thresholds (green < 800, red > 1500)', () => {
    const markup = html(base);

    expect(markup).toMatch(/data-metric="stt"[^>]*data-tone="good"/);
    expect(markup).toMatch(/data-metric="first-token"[^>]*data-tone="warn"/);
    expect(markup).toMatch(/data-metric="first-sound"[^>]*data-tone="bad"/);
    expect(markup).toMatch(/data-metric="total"[^>]*data-tone="bad"/);
  });

  it('should show a dash for a metric that is not known yet', () => {
    const markup = html({ ...base, status: 'answering', server: null, firstSoundMs: null });

    expect(markup).toMatch(/data-metric="stt"[^>]*data-tone="pending"/);
    expect(markup).toContain('—');
  });

  it('should show the escalation notice', () => {
    expect(html({ ...base, isEscalated: true })).toContain('kolléga');
  });

  it('should show an error in an alert', () => {
    const markup = html({ ...base, status: 'error', error: 'Nem hallottam semmit, próbáld újra.' });

    expect(markup).toMatch(/role="alert"[^>]*>[^<]*Nem hallottam semmit/);
  });
});
```

(Az eszkaláció-jelzés pontos szövegét a chat `message-parts.tsx` megfelelő része adja: nyisd meg, és másold a szöveget/komponenst — ha a chat külön komponenst használ az eszkalációra, azt importáld újrahasznosításra; a `contains('kolléga')` ellenőrzést az ottani tényleges szöveghez igazítsd.)

- [ ] **Step 2: Run → FAIL, then write `waterfall-panel.tsx`**

```tsx
// apps/web/src/voice/waterfall-panel.tsx
import { timingTone } from './timing-thresholds';
import type { VoiceTurn } from './voice-state';
import styles from './voice.module.css';

interface Metric {
  key: 'stt' | 'first-token' | 'first-sound' | 'total';
  label: string;
  ms: number | null;
}

function metricsOf(turn: VoiceTurn): Metric[] {
  return [
    { key: 'stt', label: 'STT', ms: turn.server?.sttMs ?? null },
    { key: 'first-token', label: 'Első token', ms: turn.server?.firstTokenMs ?? null },
    { key: 'first-sound', label: 'Első hang', ms: turn.firstSoundMs },
    { key: 'total', label: 'Összesen', ms: turn.server?.totalMs ?? null },
  ];
}

export function WaterfallPanel({ turn }: { turn: VoiceTurn }) {
  const metrics = metricsOf(turn);
  const longest = Math.max(1500, ...metrics.map((m) => m.ms ?? 0));

  return (
    <section className={styles.turn} aria-label="Fordulat">
      <p className={styles.transcript}>{turn.transcript ?? '…'}</p>
      <ul className={styles.metrics}>
        {metrics.map(({ key, label, ms }) => (
          <li
            key={key}
            className={styles.metric}
            data-metric={key}
            data-tone={ms === null ? 'pending' : timingTone(ms)}
          >
            <span className={styles.metricLabel}>{label}</span>
            <span className={styles.bar}>
              <span
                className={styles.barFill}
                style={{ width: ms === null ? '0%' : `${Math.min(100, (ms / longest) * 100)}%` }}
              />
            </span>
            <span className={styles.metricValue}>{ms === null ? '—' : `${ms} ms`}</span>
          </li>
        ))}
      </ul>
      {turn.tools.length > 0 && (
        <p className={styles.tools}>Eszközök: {turn.tools.join(', ')}</p>
      )}
      {turn.isEscalated && (
        <p className={styles.escalation}>
          Ezt a kérdést egy kollégánk veszi át.
        </p>
      )}
      {turn.text !== '' && <p className={styles.answer}>{turn.text}</p>}
      {turn.error !== null && (
        <p role="alert" className={styles.error}>
          {turn.error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write `voice-client.ts`** (hálózati réteg; a tiszta parser már tesztelt, a fetch-et a kézi próba fedi)

```ts
// apps/web/src/voice/voice-client.ts
import { createNdjsonParser } from './ndjson-parser';
import type { VoiceEvent } from './voice-events';
import type { HistoryMessage } from './voice-request-schema';

export interface StreamVoiceTurnInput {
  audio: Blob;
  history: HistoryMessage[];
  signal: AbortSignal;
  onEvent: (event: VoiceEvent) => void;
}

/** Posts one recording and reports the NDJSON events as they arrive. */
export async function streamVoiceTurn({
  audio,
  history,
  signal,
  onEvent,
}: StreamVoiceTurnInput): Promise<void> {
  const form = new FormData();
  form.append('audio', audio, 'recording');
  form.append('history', JSON.stringify(history));

  const response = await fetch('/api/voice', { method: 'POST', body: form, signal });
  if (!response.ok || response.body === null) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Hiba történt. Kérlek, próbáld újra.';
    throw new Error(message);
  }

  const parser = createNdjsonParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parser.push(decoder.decode(value, { stream: true })).forEach(onEvent);
  }
}
```

- [ ] **Step 4: Write `use-push-to-talk.ts`**

```ts
// apps/web/src/voice/use-push-to-talk.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextPttPhase, type PttEvent, type PttPhase } from './push-to-talk-machine';
import { isEditableTarget, MAX_RECORDING_MS, pickRecordingMimeType } from './recording-format';

export interface UsePushToTalkOptions {
  /** The button (or space) went down: stop any speech, abort any request. */
  onPressStart: () => void;
  /** A finished recording; `releasedAt` is `performance.now()` at the release. */
  onRecorded: (audio: Blob, releasedAt: number) => void;
  onError: (message: string) => void;
}

export interface PushToTalk {
  isRecording: boolean;
  isSupported: boolean;
  buttonProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onKeyUp: (event: React.KeyboardEvent) => void;
  };
}

const MIC_DENIED = 'A mikrofon használata nincs engedélyezve.';
const NO_RECORDER = 'Ez a böngésző nem támogatja a hangfelvételt.';

export function usePushToTalk(options: UsePushToTalkOptions): PushToTalk {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const phaseRef = useRef<PttPhase>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const discardRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    setIsSupported(
      typeof MediaRecorder !== 'undefined' &&
        pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type)) !== null,
    );
  }, []);

  const startRecording = useCallback(async () => {
    const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (mimeType === null) {
      optionsRef.current.onError(NO_RECORDER);
      phaseRef.current = 'idle';
      setIsRecording(false);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      optionsRef.current.onError(MIC_DENIED);
      phaseRef.current = 'idle';
      setIsRecording(false);
      return;
    }
    if (phaseRef.current !== 'recording') {
      // released while the permission prompt was open
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    discardRef.current = false;
    recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (!discardRef.current && chunksRef.current.length > 0) {
        optionsRef.current.onRecorded(
          new Blob(chunksRef.current, { type: mimeType }),
          performance.now(),
        );
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    timeoutRef.current = setTimeout(() => dispatch('timeout'), MAX_RECORDING_MS);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
  }, []);

  const dispatch = useCallback(
    (event: PttEvent) => {
      const { phase, action } = nextPttPhase(phaseRef.current, event);
      phaseRef.current = phase;
      setIsRecording(phase === 'recording');
      if (action === 'start') {
        optionsRef.current.onPressStart();
        void startRecording();
      } else if (action === 'stop' || action === 'discard') {
        clearTimeout(timeoutRef.current);
        discardRef.current = action === 'discard';
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (recorder !== null && recorder.state !== 'inactive') {
          recorder.stop();
        }
      }
    },
    [startRecording],
  );

  // Space works anywhere on the page except in editable fields.
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      dispatch('press');
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      dispatch('release');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [dispatch]);

  useEffect(() => () => dispatch('cancel'), [dispatch]);

  return {
    isRecording,
    isSupported,
    buttonProps: {
      onPointerDown: (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatch('press');
      },
      onPointerUp: () => dispatch('release'),
      onPointerCancel: () => dispatch('cancel'),
      // The window listeners handle Space; stop the button's own click-on-space.
      onKeyDown: (event) => {
        if (event.code === 'Space') {
          event.preventDefault();
        }
      },
      onKeyUp: (event) => {
        if (event.code === 'Space') {
          event.preventDefault();
        }
      },
    },
  };
}
```

A `startRecording` és `dispatch` kölcsönös hivatkozása (időzítő → `dispatch('timeout')`) miatt a `startRecording` tegyen a timeout-ot egy `onTimeoutRef`-en át: ha a lint vagy a tsc a `dispatch` használatát a deklaráció előtt kifogásolja, vezess be `const dispatchRef = useRef<(event: PttEvent) => void>(() => undefined)` változót, amelyet a `dispatch` definíciója után `dispatchRef.current = dispatch`-csel töltesz, és a timeout `dispatchRef.current('timeout')`-ot hívjon; az `eslint-disable` sort ekkor töröld.

- [ ] **Step 5: Write `voice-panel.tsx`, `voice.module.css`, the pages**

```tsx
// apps/web/src/voice/voice-panel.tsx
'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createAudioQueue } from './audio-queue';
import { usePushToTalk } from './use-push-to-talk';
import { streamVoiceTurn } from './voice-client';
import type { VoiceEvent } from './voice-events';
import { historyFor, initialVoiceState, voiceReducer } from './voice-state';
import styles from './voice.module.css';
import { WaterfallPanel } from './waterfall-panel';

export function VoicePanel({ escalatePrefix }: { escalatePrefix: string }) {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const releasedAtRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const queue = useMemo(
    () =>
      createAudioQueue({
        onFirstPlay: () =>
          dispatch({ type: 'first-sound', ms: Math.round(performance.now() - releasedAtRef.current) }),
      }),
    [],
  );

  // Warm the filler sentences in the background (best effort).
  useEffect(() => {
    void fetch('/api/voice/warmup', { method: 'POST' }).catch(() => undefined);
  }, []);

  const handleEvent = (event: VoiceEvent): void => {
    if (event.type === 'filler') {
      queue.enqueue(event.audio, 'filler');
    } else if (event.type === 'sentence') {
      queue.enqueue(event.audio, 'sentence');
    }
    dispatch({ type: 'event', event });
  };

  const { isRecording, isSupported, buttonProps } = usePushToTalk({
    onPressStart: () => {
      // Barge-in: silence the speech and stop the request in flight.
      setNotice(null);
      queue.stop();
      abortRef.current?.abort();
      dispatch({ type: 'aborted' });
    },
    onError: setNotice,
    onRecorded: (audio, releasedAt) => {
      releasedAtRef.current = releasedAt;
      const controller = new AbortController();
      abortRef.current = controller;
      const history = historyFor(stateRef.current, escalatePrefix);
      dispatch({ type: 'turn-started' });
      streamVoiceTurn({ audio, history, signal: controller.signal, onEvent: handleEvent }).catch(
        (error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          dispatch({
            type: 'failed',
            message: error instanceof Error ? error.message : 'Hiba történt. Kérlek, próbáld újra.',
          });
        },
      );
    },
  });

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.talk}
        data-recording={isRecording}
        disabled={!isSupported}
        aria-pressed={isRecording}
        {...buttonProps}
      >
        {isRecording ? 'Hallgatlak…' : 'Tartsd nyomva a beszédhez (vagy szóköz)'}
      </button>
      {!isSupported && (
        <p role="alert" className={styles.error}>
          Ez a böngésző nem támogatja a hangfelvételt.
        </p>
      )}
      {notice !== null && (
        <p role="alert" className={styles.error}>
          {notice}
        </p>
      )}
      <div className={styles.turns}>
        {[...state.turns].reverse().map((turn) => (
          <WaterfallPanel key={turn.id} turn={turn} />
        ))}
      </div>
    </div>
  );
}
```

`voice.module.css` — tokenek a meglévő `global.css`-ből (`--bg`, `--border`, `--surface` a chat-szpec szerint léteznek; nyisd meg a `global.css`-t és a ténylegesen definiált változókat használd). Tartalma:

```css
.panel { display: flex; flex-direction: column; gap: 16px; flex: 1; }
.talk {
  min-height: 72px; font-size: 1.1rem; border-radius: 12px;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer;
  touch-action: none; user-select: none;
}
.talk[data-recording='true'] { outline: 3px solid var(--accent, #2f7d4f); }
.talk:disabled { opacity: 0.5; cursor: not-allowed; }
.turns { display: flex; flex-direction: column; gap: 16px; }
.turn { border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.transcript { font-weight: 600; margin: 0; }
.answer, .tools, .escalation { margin: 0; }
.metrics { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.metric { display: grid; grid-template-columns: 6.5rem 1fr 5rem; align-items: center; gap: 8px; font-size: 0.9rem; }
.bar { height: 10px; border-radius: 5px; background: var(--border); overflow: hidden; }
.barFill { display: block; height: 100%; background: var(--tone, gray); }
.metric[data-tone='good'] { --tone: #2e9e5b; }
.metric[data-tone='warn'] { --tone: #d9a400; }
.metric[data-tone='bad'] { --tone: #d64545; }
.metric[data-tone='pending'] { --tone: transparent; }
.metricValue { text-align: right; font-variant-numeric: tabular-nums; }
.error { color: #d64545; margin: 0; }
@media (max-width: 480px) { .metric { grid-template-columns: 5rem 1fr 4.2rem; } }
```

```tsx
// apps/web/src/app/voice/page.tsx
import { ESCALATE_PREFIX } from 'core';
import Link from 'next/link';
import { VoicePanel } from '../../voice/voice-panel';
import styles from '../page.module.css';

export default function VoicePage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Plantbase hang</h1>
        <p>
          Tartsd nyomva a gombot (vagy a szóközt), és kérdezz magyarul. <Link href="/">Vissza a szöveges chatre</Link>
        </p>
      </header>
      <VoicePanel escalatePrefix={ESCALATE_PREFIX} />
    </main>
  );
}
```

`apps/web/src/app/page.tsx`: a fejléc `<p>` után (vagy abba) egy sor: `<p><Link href="/voice">Beszélj hozzá hangosan →</Link></p>`; `import Link from 'next/link';`.

`voice-panel.spec.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoicePanel } from './voice-panel';

describe('VoicePanel', () => {
  it('should render the hold-to-talk button and no turns at first', () => {
    const markup = renderToStaticMarkup(<VoicePanel escalatePrefix="[ESCALATE] " />);

    expect(markup).toContain('Tartsd nyomva a beszédhez');
    expect(markup).not.toContain('Fordulat');
  });
});
```

(Az SSR-en az `isSupported` kezdőértéke `true`, így a gomb nem `disabled`.)

- [ ] **Step 6: Run everything**

Run: `pnpm nx run-many -t lint,typecheck,test -p web` majd `pnpm nx build web`
Expected: PASS; a build csak a korábbról ismert webpack-figyelmeztetést adhatja.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/voice/voice-client.ts apps/web/src/voice/use-push-to-talk.ts apps/web/src/voice/waterfall-panel.tsx apps/web/src/voice/waterfall-panel.spec.tsx apps/web/src/voice/voice-panel.tsx apps/web/src/voice/voice-panel.spec.tsx apps/web/src/voice/voice.module.css apps/web/src/app/voice/page.tsx apps/web/src/app/page.tsx
git commit -m "feat(web): add the voice page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dokumentáció, mérési sablon, végső ellenőrzés

**Files:**
- Modify: `CLAUDE.md`, `docs/architektura.md`, `.env.example`, `README.md`
- Create: `docs/voice-meresek.md`

- [ ] **Step 1: `.env.example`** — a fájl végére (a `.env`-hez nem nyúlunk):

```
# Hang (/voice): csak szerveren használt kulcs; hiányában a /voice érthető hibát ad
OPENAI_API_KEY=
# Opcionális felülírások (alapértékek: gpt-transcribe, gpt-4o-mini-tts, coral)
# VOICE_STT_MODEL=gpt-transcribe
# VOICE_TTS_MODEL=gpt-4o-mini-tts
# VOICE_TTS_VOICE=coral
```

- [ ] **Step 2: `docs/voice-meresek.md` sablon**

```markdown
# Hang-mérések (kézi próba)

> A `/voice` oldal waterfall panelje alapján kitöltendő. Zöld < 800 ms, piros > 1500 ms. Az „első hang” a gomb felengedésétől az első hangig (filler is számít) kliensoldalon mért idő.

| Kérdés | STT-átirat | Modell (STT / TTS / hang) | STT ms | Első token ms | Első hang ms | Összesen ms | Filler BE/KI | Megjegyzés |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |
```

- [ ] **Step 3: `README.md`** — új szakasz a web chat leírása mellé: a `/voice` oldal (nyomva tartott gomb / szóköz, barge-in), az `OPENAI_API_KEY` szükségessége (csak szerveren), a `VOICE_STT_MODEL`, `VOICE_TTS_MODEL`, `VOICE_TTS_VOICE` változók és alapértékeik, a 30 s / 2 MB / 1200 karakteres korlátok, valamint a `docs/voice-meresek.md` hivatkozása.

- [ ] **Step 4: `CLAUDE.md`** — az `apps/web` bekezdéshez: a `/voice` oldal és az `/api/voice` (NDJSON, `voice-turn.ts`), a `core` `mode: 'text' | 'voice'` opciója és a `VOICE_PROMPT_SECTION` (a `docs/system-prompt.md`-ben csak hivatkozás), a „hangot nem tárolunk, átirat csak a JSONL-ban, az üzemi logban csak esemény+ms (`safe-error-fields.ts`)” szabály, és az, hogy az új `@ai-sdk/openai` pontosan `2.0.135`. A „Fontos, kézzel felvett szabályok” blokkhoz **ne** nyúlj.

- [ ] **Step 5: `docs/architektura.md`** — az 1. főbb döntéshez egy mondat: az ask-agentnek `text` és `voice` módja van (`streamAskAgent` `mode` opció), a hang I/O (STT/TTS) az `apps/web`-ben él, a core framework-agnosztikus marad. A fájlstruktúra-vázlatban az `apps/web` sorához: „chat + /voice”.

- [ ] **Step 6: Végső ellenőrzés**

Run: `pnpm nx run-many -t lint,typecheck,test` → minden projekt PASS.
Run: `pnpm nx build web` → PASS (csak az ismert figyelmeztetés).
Run: `git diff --stat main -- packages/core/src/agents/ask-agent/ask-agent-prompt.ts .env` → üres.
Run: `git status --short` → a `docs/projekt-statusz.md` továbbra is `??` (követetlen).

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/architektura.md .env.example README.md docs/voice-meresek.md
git commit -m "docs: document the voice mode

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Kézi próba és review**

A spec 7.3 pontjai szerint (`pnpm nx dev web`, `http://localhost:3001/voice`, `OPENAI_API_KEY` a gyökér `.env`-ben): először a `gpt-transcribe` + fetch-wrapper **smoke** (ha az API elutasítja → `VOICE_STT_MODEL=gpt-4o-transcribe`, és az alapérték változik a `voice-config.ts`-ben + a specben), utána a barge-in, a Space, a 30 s-os limit, a filler (és az 5 s-os frissítés), az eszkaláció, a többfordulós követő kérdés, 2–3 TTS-hang összevetése, a mérések kitöltése a `docs/voice-meresek.md`-be. Végül független reviewer az egész ágra. Push, PR és merge csak kifejezett jóváhagyással.
