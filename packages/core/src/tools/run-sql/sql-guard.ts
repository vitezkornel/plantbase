// packages/core/src/tools/run-sql/sql-guard.ts
//
// The last application-level checkpoint before an LLM-generated string is
// executed as SQL against a real (if read-only-role-protected) database
// connection. Never throws — a rejection is reported back as a normal
// result so `run-sql-tool.ts` can hand it to the model as a `tool_result`
// instead of crashing the whole request (docs task brief: "a manipulative
// question should result in a graceful, explained refusal, not a crash").
//
// This is a pragmatic, well-tested KEYWORD scan, not a full SQL parser —
// deliberately: a real parser would be over-engineering for this project's
// scope (konvenciok.md / stack.md don't call for one), and the read-only
// `plantbase_readonly` Postgres role (packages/db, task A4 —
// packages/db/sql/create-readonly-role.sql) is a genuine, independent,
// DB-enforced backstop regardless of any bug in this guard. Belt AND
// suspenders, not "trust the guard alone."

export type SqlGuardResult = { ok: true } | { ok: false; error: string };

// Keywords that mutate data/schema, or that can be abused to smuggle a
// write past a naive "does it start with SELECT" check. Checked ANYWHERE
// in the query text — not just the first token — specifically because of
// a real, documented Postgres bypass: data-modifying Common Table
// Expressions (CTEs). For example:
//
//   WITH deleted AS (DELETE FROM products RETURNING *) SELECT * FROM deleted;
//
// This is syntactically ONE statement, and it starts with `WITH ... SELECT`
// -shaped structure — a guard that only inspects the first token would let
// it straight through, while the DELETE inside the CTE body still runs.
// Scanning the full query text for these keywords (with the START check
// below only used to positively require SELECT/WITH, never to positively
// clear the rest of the text) is what catches this.
const BLOCKED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'MERGE',
  'CALL',
  'DO', // anonymous procedural code block: DO $$ ... $$
  'INTO', // SELECT ... INTO new_table is DDL-equivalent (creates a table)
  'EXECUTE',
  'PREPARE',
  'VACUUM',
  'REINDEX',
  'REFRESH',
  'LISTEN',
  'NOTIFY',
  'LOCK',
  'SECURITY',
  'COMMENT',
  'IMPORT',
] as const;

const BLOCKED_KEYWORDS_PATTERN = new RegExp(
  `\\b(${BLOCKED_KEYWORDS.join('|')})\\b`,
  'i',
);

const READ_ONLY_START_PATTERN = /^(SELECT|WITH)\b/i;

/**
 * Validates that `sql` is a single, read-only SELECT statement (optionally
 * a `WITH` prefix, as long as no CTE inside it mutates anything). See the
 * module comment above for the specific bypasses this defends against.
 */
export function guardReadOnlySql(sql: string): SqlGuardResult {
  const trimmed = sql.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: 'A generált SQL üres.' };
  }

  // Allow at most one trailing semicolon. Anything left after stripping it
  // means there is more than one statement — a stacked query, e.g.
  // `SELECT 1; DROP TABLE products;`.
  const withoutTrailingSemicolon = trimmed.endsWith(';')
    ? trimmed.slice(0, -1)
    : trimmed;

  if (withoutTrailingSemicolon.includes(';')) {
    return {
      ok: false,
      error:
        'Csak egyetlen SQL statement engedélyezett — több, pontosvesszővel elválasztott statement nem futtatható.',
    };
  }

  if (!READ_ONLY_START_PATTERN.test(withoutTrailingSemicolon)) {
    return {
      ok: false,
      error:
        'Csak SELECT (vagy SELECT-re vezető WITH) statement engedélyezett.',
    };
  }

  const blockedMatch = withoutTrailingSemicolon.match(BLOCKED_KEYWORDS_PATTERN);
  if (blockedMatch) {
    return {
      ok: false,
      error: `Az SQL adatmódosító vagy DDL kulcsszót tartalmaz (${blockedMatch[0].toUpperCase()}) — csak olvasás engedélyezett.`,
    };
  }

  return { ok: true };
}
