import { formatEcho } from './ask-command.js';

describe('formatEcho', () => {
  it('should prefix the input with "Echo: "', () => {
    expect(formatEcho('szia')).toBe('Echo: szia');
  });

  it('should preserve the input verbatim, including internal whitespace', () => {
    expect(formatEcho('mennyibe kerul  a monstera?')).toBe(
      'Echo: mennyibe kerul  a monstera?',
    );
  });

  it('should return "Echo: " when given an empty string', () => {
    expect(formatEcho('')).toBe('Echo: ');
  });
});
