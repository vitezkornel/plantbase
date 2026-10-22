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
      if (char === '.' && isAbbreviation(buffer.slice(start, i))) {
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
function isAbbreviation(before: string): boolean {
  const lastWord = before.split(/\s/).pop()?.toLowerCase() ?? '';
  // a bare leading number is list numbering ("1. Először"), not a sentence
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

export function createSpokenBudget(
  max: number = MAX_SPOKEN_CHARS,
): SpokenBudget {
  let used = 0;
  let isClosed = false;

  return {
    take(sentence) {
      if (isClosed) {
        return null;
      }
      if (used + sentence.length > max) {
        isClosed = true;
        // The very first chunk can already be over budget (an answer with no
        // sentence end): cut it, so the per-turn cap always holds.
        return used === 0
          ? `${cutAtWord(sentence, max)}. ${CLOSING_SENTENCE}`
          : CLOSING_SENTENCE;
      }
      used += sentence.length;
      return sentence;
    },
  };
}

function cutAtWord(text: string, max: number): string {
  const cut = text.slice(0, max);
  const next = text[max];
  const atBoundary = next === undefined || /\s/.test(next);
  const lastSpace = cut.lastIndexOf(' ');
  const word = atBoundary || lastSpace <= 0 ? cut : cut.slice(0, lastSpace);
  return word.replace(/[\s,;:]+$/, '');
}
