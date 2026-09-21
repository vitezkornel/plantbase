import { isIndependentList } from './is-independent-list.js';

export interface Chunk {
  title: string;
  source: string;
  /** The parent Markdown heading text, or null for the article's preamble. */
  sectionPath: string | null;
  content: string;
}

export interface ChunkArticleInput {
  title: string;
  source: string;
  /** Already cleaned (strip-boilerplate applied) article body. */
  body: string;
}

interface Section {
  heading: string | null;
  content: string;
}

const HEADING_LINE_PATTERN = /^#{1,6}\s+(.*)$/;
// Bold or plain numbered list item start, e.g. "1. Water and enjoy" or
// "**1. Water and enjoy**".
const NUMBERED_ITEM_START_PATTERN = /^(?:\*\*)?\d+\.\s?/;
const MIN_ITEMS_TO_TREAT_AS_LIST = 3;

/**
 * Splits an article into chunks: primarily along the author's own Markdown
 * headings (dontesek-hf3.md #3), with numbered lists of 3+ items further
 * classified as an independent catalog (one chunk per item) or a coherent
 * sequence (kept whole) via `isIndependentList` (#4-#7, #9).
 */
export function chunkArticle({
  title,
  source,
  body,
}: ChunkArticleInput): Chunk[] {
  const sections = splitIntoSections(normalizeLineEndings(body), title);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    if (section.content.trim().length === 0) {
      continue;
    }
    chunks.push(...sectionToChunks(section, title, source));
  }
  return chunks;
}

/**
 * `HEADING_LINE_PATTERN` (and other line-based patterns below) anchor on
 * `$`/end-of-line, which never matches while a trailing `\r` is still
 * there — so a CRLF- (or old-Mac CR-)terminated body would silently fail
 * to split at all. Article content can legitimately arrive with either
 * line-ending style (pasted/exported from Windows tools, or checked out
 * on a machine with `core.autocrlf=true`), so this normalizes once, up
 * front, rather than trying to make every downstream regex CRLF-aware.
 */
function normalizeLineEndings(body: string): string {
  return body.replace(/\r\n?/g, '\n');
}

function splitIntoSections(body: string, title: string): Section[] {
  const lines = stripLeadingTitleHeading(body, title).split('\n');

  const headings: { lineIndex: number; text: string }[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    const match = HEADING_LINE_PATTERN.exec(line);
    if (match) {
      headings.push({
        lineIndex,
        text: normalizeHeadingText(match[1] ?? ''),
      });
    }
  }

  const sections: Section[] = [];

  const preambleEnd = headings[0]?.lineIndex ?? lines.length;
  sections.push({
    heading: null,
    content: lines.slice(0, preambleEnd).join('\n').trim(),
  });

  for (const [i, heading] of headings.entries()) {
    const contentEnd = headings[i + 1]?.lineIndex ?? lines.length;
    sections.push({
      heading: heading.text,
      content: lines
        .slice(heading.lineIndex + 1, contentEnd)
        .join('\n')
        .trim(),
    });
  }

  return sections;
}

/**
 * Some articles wrap their heading text in inline bold markers (e.g.
 * "##### **What are some easy low light tolerant plants?**") purely for
 * visual emphasis, redundant with the heading level itself — stripped so
 * `sectionPath` is plain, comparable text.
 */
function normalizeHeadingText(headingText: string): string {
  return headingText.replace(/\*\*/g, '').trim();
}

function stripLeadingTitleHeading(body: string, title: string): string {
  const lines = body.split('\n');
  if (lines[0]?.trim() === `# ${title.trim()}`) {
    return lines.slice(1).join('\n');
  }
  return body;
}

function sectionToChunks(
  section: Section,
  title: string,
  source: string,
): Chunk[] {
  const items = extractNumberedItems(section.content);

  if (
    items.length >= MIN_ITEMS_TO_TREAT_AS_LIST &&
    section.heading !== null &&
    isIndependentList({ articleTitle: title, sectionHeading: section.heading })
  ) {
    return items.map((item) => ({
      title,
      source,
      sectionPath: section.heading,
      content: `${section.heading}\n\n${item.trim()}`,
    }));
  }

  return [
    {
      title,
      source,
      sectionPath: section.heading,
      content:
        section.heading === null
          ? section.content
          : `${section.heading}\n\n${section.content}`,
    },
  ];
}

/** Splits a section's content into its top-level numbered-list items, if any. */
function extractNumberedItems(content: string): string[] {
  const lines = content.split('\n');
  const itemStartIndices: number[] = [];
  for (const [i, line] of lines.entries()) {
    if (NUMBERED_ITEM_START_PATTERN.test(line.trim())) {
      itemStartIndices.push(i);
    }
  }

  if (itemStartIndices.length < MIN_ITEMS_TO_TREAT_AS_LIST) {
    return [];
  }

  return itemStartIndices.map((startIndex, i) => {
    const endIndex = itemStartIndices[i + 1] ?? lines.length;
    return lines.slice(startIndex, endIndex).join('\n').trim();
  });
}
