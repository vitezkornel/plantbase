import { describe, expect, it } from 'vitest';
import { splitEscalation } from './escalation';

const PREFIX = '[ESCALATE] ';

describe('splitEscalation', () => {
  it('should strip the prefix and flag the answer when it is escalated', () => {
    expect(
      splitEscalation(`${PREFIX}Egy kollégánk jelentkezik.`, PREFIX),
    ).toEqual({
      text: 'Egy kollégánk jelentkezik.',
      isEscalated: true,
    });
  });

  it('should leave a normal answer untouched', () => {
    expect(splitEscalation('Íme a kínálat.', PREFIX)).toEqual({
      text: 'Íme a kínálat.',
      isEscalated: false,
    });
  });

  it('should hide a still-streaming partial prefix instead of flashing it', () => {
    expect(splitEscalation('[ESCA', PREFIX)).toEqual({
      text: '',
      isEscalated: false,
    });
  });

  it('should not treat the prefix as escalation when it is not at the start', () => {
    expect(splitEscalation(`Szia! ${PREFIX}`, PREFIX).isEscalated).toBe(false);
  });
});
