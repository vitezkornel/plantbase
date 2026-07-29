import { z } from 'zod';

const FRONT_MATTER_DELIMITER = '---';

const FrontMatterSchema = z.object({
  title: z.string().min(1),
  source: z.string().min(1),
  category: z.string().min(1),
});

export interface ParsedArticle {
  title: string;
  source: string;
  category: string;
  body: string;
}

/**
 * Splits a `data/knowledge/*.md` article into its front matter
 * (title/source/category) and body — the front matter fields are stored
 * alongside every chunk for grounding (dontesek-hf3.md #1), separately from
 * the body text that chunking operates on.
 */
export function parseArticle(raw: string): ParsedArticle {
  const lines = raw.split('\n');

  if (lines[0]?.trim() !== FRONT_MATTER_DELIMITER) {
    throw new Error(
      'Article is missing front matter (expected a leading "---" line).',
    );
  }

  const closingIndex = lines.findIndex(
    (line, i) => i > 0 && line.trim() === FRONT_MATTER_DELIMITER,
  );
  if (closingIndex === -1) {
    throw new Error(
      'Article front matter is not closed (missing closing "---" line).',
    );
  }

  const rawFrontMatter: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    rawFrontMatter[key] = value;
  }

  const frontMatter = FrontMatterSchema.parse(rawFrontMatter);
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .trim();

  return { ...frontMatter, body };
}
