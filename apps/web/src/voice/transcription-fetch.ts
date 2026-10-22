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
