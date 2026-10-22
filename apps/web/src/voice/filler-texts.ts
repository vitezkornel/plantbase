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
