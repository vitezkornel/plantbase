// packages/core/src/tools/customer-preferences/customer-preferences-tool.ts
//
// The `customerPreferences` tool: looks up a named customer's previously
// recorded shopping preferences (budget, light requirement, pet-safety
// need) from a static, in-memory list — no DB involved, unlike run-sql/
// list-categories/search-knowledge. Everything this ONE tool needs lives
// in this ONE directory (konvenciok.md: "egy fogalom = egy könyvtár").

import { tool } from 'ai';
import type { ToolOutcome } from '../tool-outcome.js';
import { CustomerPreferencesInputSchema } from './customer-preferences-schema.js';

export const CUSTOMER_PREFERENCES_TOOL_NAME = 'customerPreferences';

export interface CustomerPreference {
  name: string;
  budget: number;
  light: string;
  petSafe: boolean;
}

const CUSTOMER_PREFERENCES: readonly CustomerPreference[] = [
  { name: 'Exeter', budget: 15000, light: 'alacsony', petSafe: true },
  { name: 'Komi', budget: 40000, light: 'erős', petSafe: false },
  { name: 'Duline', budget: 8000, light: 'közepes', petSafe: true },
];

/**
 * Executes one `customerPreferences` tool call: validates the (untrusted,
 * LLM-produced) input, then looks up the named customer (case-insensitive,
 * trimmed) in the static list. Never throws — an unknown name comes back
 * as `{ ok: false, error }` so the agent-loop can feed it to the model as
 * a normal tool result and let the model explain itself, instead of
 * crashing the request.
 */
export async function executeCustomerPreferences(
  rawInput: unknown,
): Promise<ToolOutcome> {
  try {
    const parsed = CustomerPreferencesInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Érvénytelen customerPreferences input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      };
    }

    const searchedName = parsed.data.name.trim().toLowerCase();
    const match = CUSTOMER_PREFERENCES.find(
      (customer) => customer.name.toLowerCase() === searchedName,
    );

    if (!match) {
      const knownNames = CUSTOMER_PREFERENCES.map((c) => c.name).join(', ');
      return {
        ok: false,
        error: `Nincs rögzített preferencia "${parsed.data.name}" nevű ügyfélhez. Ismert ügyfelek: ${knownNames}.`,
      };
    }

    return { ok: true, data: { ...match } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Hiba az ügyfél-preferenciák keresése közben: ${message}`,
    };
  }
}

export const customerPreferencesTool = tool({
  description:
    'Visszaadja egy megnevezett ügyfél korábban rögzített preferenciáit ' +
    '(költségkeret, fényigény, háziállat-biztonság igénye) egy statikus ' +
    'ügyféllistából. Ezt hívd, ha a kérdés egy konkrét, névvel azonosított ' +
    'ügyfél korábban rögzített igényeire kérdez rá, ne találgasd ki a ' +
    'preferenciákat magadtól.',
  inputSchema: CustomerPreferencesInputSchema,
  execute: executeCustomerPreferences,
});
