// DEMO ONLY (VOICE_DEMO_ORDERS=1). Made-up data that never touches the
// ask-agent or the database; it exists to show a slow backend tool call and
// what the filler does for it. The `demo` flag travels to the model (it must
// say so) and to the UI (the "DEMO" label).

export const DEMO_DELAY_MS = 6000;

export const FAKE_ORDER = {
  demo: true,
  orderId: '12345',
  status: 'kiszállítás alatt',
  courier: 'GLS',
  expected: 'csütörtök',
  note: 'demó adat, nem valódi rendelés',
} as const;
