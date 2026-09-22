// packages/core/src/tools/customer-preferences/customer-preferences-tool.spec.ts
//
// konvenciok.md: "A teszt a tesztelt kód mellett lakik" — direct unit
// tests of `executeCustomerPreferences` (mirroring run-sql-tool.spec.ts /
// list-categories-tool.spec.ts's shape: fast, no external dependency here
// since the data is a static in-memory list), plus a real MockLanguageModelV2
// + generateText round-trip proving the tool works through the actual AI
// SDK loop, not just as a plain function.

import { generateText, stepCountIs } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_PREFERENCES_TOOL_NAME,
  customerPreferencesTool,
  executeCustomerPreferences,
} from './customer-preferences-tool.js';
import { CustomerPreferencesInputSchema } from './customer-preferences-schema.js';

describe('executeCustomerPreferences', () => {
  it('returns Exeter’s preferences', async () => {
    const outcome = await executeCustomerPreferences({ name: 'Exeter' });

    expect(outcome).toEqual({
      ok: true,
      data: { name: 'Exeter', budget: 15000, light: 'alacsony', petSafe: true },
    });
  });

  it('returns Komi’s preferences', async () => {
    const outcome = await executeCustomerPreferences({ name: 'Komi' });

    expect(outcome).toEqual({
      ok: true,
      data: { name: 'Komi', budget: 40000, light: 'erős', petSafe: false },
    });
  });

  it('returns Duline’s preferences', async () => {
    const outcome = await executeCustomerPreferences({ name: 'Duline' });

    expect(outcome).toEqual({
      ok: true,
      data: { name: 'Duline', budget: 8000, light: 'közepes', petSafe: true },
    });
  });

  it('matches the customer name case-insensitively and trims whitespace', async () => {
    const outcome = await executeCustomerPreferences({ name: '  exeter ' });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.data as { name: string }).name).toBe('Exeter');
    }
  });

  it('returns ok:false with a descriptive Hungarian message when the customer is unknown', async () => {
    const outcome = await executeCustomerPreferences({ name: 'Ismeretlen Ügyfél' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/Ismeretlen Ügyfél/);
      expect(outcome.error).toMatch(/Exeter/);
      expect(outcome.error).toMatch(/Komi/);
      expect(outcome.error).toMatch(/Duline/);
    }
  });

  it('rejects a missing name field via Zod', async () => {
    const outcome = await executeCustomerPreferences({});

    expect(outcome.ok).toBe(false);
  });

  it('rejects a non-string name via Zod', async () => {
    const outcome = await executeCustomerPreferences({ name: 42 });

    expect(outcome.ok).toBe(false);
  });

  it('rejects a non-object input via Zod', async () => {
    const outcome = await executeCustomerPreferences('Exeter');

    expect(outcome.ok).toBe(false);
  });
});

describe('customerPreferencesTool — AI SDK tool definition', () => {
  it('declares the tool name constant and reuses the name-required Zod schema', () => {
    expect(CUSTOMER_PREFERENCES_TOOL_NAME).toBe('customerPreferences');
    expect(customerPreferencesTool.inputSchema).toBe(
      CustomerPreferencesInputSchema,
    );
  });
});

describe('customerPreferencesTool — through the real AI SDK tool-use loop', () => {
  function usage() {
    return { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  }

  it('dispatches a customerPreferences tool call and lets the model answer from the result', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: [
        {
          finishReason: 'tool-calls',
          usage: usage(),
          warnings: [],
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: CUSTOMER_PREFERENCES_TOOL_NAME,
              input: JSON.stringify({ name: 'Komi' }),
            },
          ],
        },
        {
          finishReason: 'stop',
          usage: usage(),
          warnings: [],
          content: [{ type: 'text', text: 'Komi 40000 Ft-os keretet adott meg.' }],
        },
      ],
    });

    const result = await generateText({
      model,
      prompt: 'Mik Komi preferenciái?',
      tools: { [CUSTOMER_PREFERENCES_TOOL_NAME]: customerPreferencesTool },
      stopWhen: stepCountIs(6),
    });

    expect(result.text).toBe('Komi 40000 Ft-os keretet adott meg.');
    const toolResult = result.steps[0]?.toolResults[0];
    expect(toolResult?.output).toEqual({
      ok: true,
      data: { name: 'Komi', budget: 40000, light: 'erős', petSafe: false },
    });
  });

  it('feeds an unknown-customer outcome back to the model as a normal tool result instead of throwing', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: [
        {
          finishReason: 'tool-calls',
          usage: usage(),
          warnings: [],
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: CUSTOMER_PREFERENCES_TOOL_NAME,
              input: JSON.stringify({ name: 'Senkise' }),
            },
          ],
        },
        {
          finishReason: 'stop',
          usage: usage(),
          warnings: [],
          content: [{ type: 'text', text: 'Nincs ilyen ügyfél nyilvántartva.' }],
        },
      ],
    });

    const result = await generateText({
      model,
      prompt: 'Mik Senkise preferenciái?',
      tools: { [CUSTOMER_PREFERENCES_TOOL_NAME]: customerPreferencesTool },
      stopWhen: stepCountIs(6),
    });

    expect(result.text).toBe('Nincs ilyen ügyfél nyilvántartva.');
    const toolResult = result.steps[0]?.toolResults[0];
    const output = toolResult?.output as { ok: boolean; error?: string };
    expect(output.ok).toBe(false);
    expect(output.error).toMatch(/Senkise/);
  });
});
