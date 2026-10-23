// Tool definitions in the Realtime API's flat function-tool shape. The names
// are shared with the browser (tool-dispatch), so they live here once.

export const ASK_PLANTBASE_TOOL_NAME = 'askPlantbase';
export const GET_ORDER_STATUS_TOOL_NAME = 'getOrderStatus';

export const ASK_PLANTBASE_TOOL = {
  type: 'function',
  name: ASK_PLANTBASE_TOOL_NAME,
  description:
    'A Plantbase szakértőjét kérdezi: növénykatalógus (termék, ár, készlet, ' +
    'kategória) és gondozási tudástár. Minden termék-, ár-, készlet- és ' +
    'gondozási kérdéshez ezt használd. A kérdés önállóan érthető legyen.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'Önállóan érthető magyar kérdés, a korábbi kontextussal együtt.',
      },
    },
    required: ['question'],
  },
} as const;

// DEMO only (VOICE_DEMO_ORDERS=1): fake data, see demo-orders.ts.
export const GET_ORDER_STATUS_TOOL = {
  type: 'function',
  name: GET_ORDER_STATUS_TOOL_NAME,
  description:
    'DEMÓ: egy rendelés állapota a rendelésszám alapján (kitalált adat). ' +
    'Lassú hívás. A válaszban jelezd, hogy ez demó adat.',
  parameters: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'A rendelés azonosítója.' },
    },
    required: ['orderId'],
  },
} as const;
