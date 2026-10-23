import { describe, expect, it } from 'vitest';
import { realtimeInstructions } from './realtime-instructions';

describe('realtimeInstructions', () => {
  const on = realtimeInstructions(true);
  const off = realtimeInstructions(false);

  it('should require Hungarian answers', () => {
    expect(on).toContain('mindig magyarul');
  });

  it('should allow product, price, stock and care claims only from askPlantbase', () => {
    expect(on).toMatch(/csak az askPlantbase/i);
    expect(on).toContain('ne találj ki semmit');
  });

  it('should demand a self-contained question for askPlantbase', () => {
    expect(on).toContain('önállóan érthető');
    expect(on).toContain('Melyik kaktusz háziállat-barát?');
  });

  it('should demand a faithful relay of name, price and source title', () => {
    expect(on).toContain('szó szerint');
  });

  it('should speak the source title but never a URL', () => {
    expect(on).toContain('cikk címét');
    expect(on).toContain('URL-t nem');
  });

  it('should hand escalated answers to a colleague', () => {
    expect(on).toContain('escalated');
    expect(on).toContain('kolléga');
  });

  it('should tell the model to drop stale results', () => {
    expect(on).toContain('stale');
  });

  it('should differ only in the filler section', () => {
    expect(on).not.toBe(off);
    expect(on).toContain('<filler mode="on">');
    expect(off).toContain('<filler mode="off">');
    expect(on.replace(/<filler[\s\S]*?<\/filler>/, '')).toBe(
      off.replace(/<filler[\s\S]*?<\/filler>/, ''),
    );
  });

  it('should keep claims out of the filler', () => {
    expect(on).toMatch(/nem állíthatsz[\s\S]*termékről[\s\S]*árról/);
  });

  it('should keep silent during the tool call when the filler is off', () => {
    expect(off).toContain('hallgass');
  });
});
