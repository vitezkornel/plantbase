import { describe, expect, it } from 'vitest';
import { VOICE_PROMPT_SECTION } from './voice-prompt';

describe('VOICE_PROMPT_SECTION', () => {
  it('should ask for the title of the source article to be spoken', () => {
    expect(VOICE_PROMPT_SECTION).toContain(
      'mondd ki a forrás cikk címét (például: »A Monstera gondozása című cikk szerint…«)',
    );
  });

  it('should forbid speaking a URL', () => {
    expect(VOICE_PROMPT_SECTION).toContain('URL-t ne mondj.');
  });

  it('should no longer use the vague reference to the knowledge base', () => {
    expect(VOICE_PROMPT_SECTION).not.toContain('a gondozási tudástár szerint');
  });
});
