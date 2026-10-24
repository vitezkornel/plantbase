import { describe, expect, it } from 'vitest';
import { realtimeInstructions } from './realtime-instructions';
import { ASK_PLANTBASE_TOOL } from './realtime-tools';

describe('realtimeInstructions', () => {
  const on = realtimeInstructions(true);
  const off = realtimeInstructions(false);

  it('should be a plant catalogue advisor, not an interior designer', () => {
    expect(on).toContain('Plantbase növénykatalógus-tanácsadója');
    expect(on).not.toContain('lakberendez');
  });

  it('should ask back when it is unsure what the user said', () => {
    expect(on).toMatch(/bizonytalan vagy, mit mondott a felhasználó[^.]*kérdezz vissza/);
  });

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

  it('should not call askPlantbase for noise, a cough or an unintelligible utterance', () => {
    expect(on).toMatch(/köhögés[\s\S]*nevetés[\s\S]*háttérzaj/);
    expect(on).toMatch(/NE hívd meg az askPlantbase/);
    expect(on).toMatch(/röviden kérdezz vissza/);
  });

  it('should keep the question to the user’s own words and topic', () => {
    expect(on).toMatch(/kulcsszavakat[^.]*szó szerint/);
    expect(on).toMatch(/ne adj hozzá olyan témát, amit a felhasználó nem mondott/);
  });

  it('should take the topic of a correction or short follow-up from the user’s earlier words', () => {
    expect(on).toMatch(/javításnál vagy rövid kérdésnél/i);
    expect(on).toMatch(/ne a saját korábbi kérdésedből vagy válaszodból/);
  });

  it('should no longer ask to copy the whole earlier context into the question', () => {
    expect(on).not.toContain('írd bele a korábbi kontextust');
    expect(ASK_PLANTBASE_TOOL.description).not.toContain('korábbi kontextussal');
    expect(ASK_PLANTBASE_TOOL.parameters.properties.question.description).not.toContain(
      'korábbi kontextussal',
    );
  });

  it('should demand a faithful relay of name, price and source title', () => {
    expect(on).toContain('szó szerint');
  });

  it('should speak the source title but never a URL', () => {
    expect(on).toContain('cikk címét');
    expect(on).toContain('URL-t nem');
  });

  it('should say the source title only when the answer has one', () => {
    expect(on).toMatch(/Ha a supervisor válaszában szerepel forráscikk címe[^.]*mondd ki/);
    expect(on).not.toMatch(/az árat és a forráscikk címét szó szerint mondd ki/);
  });

  it('should treat a catalogue answer without a source as complete, not as missing something', () => {
    expect(on).toMatch(/katalógus[^.]*nincs forráscikk[^.]*nem hiány/);
    expect(on).toMatch(/Ne hiányold a forrást/);
    expect(on).toMatch(/mondd ki hűen/);
  });

  it('should say the supervisor answers the user’s real question and wins over the model’s own reading', () => {
    expect(on).toMatch(/userQuestion[^.]*felhasználó pontos átirata/);
    expect(on).toMatch(/más témájú[^.]*supervisornak van igaza/);
    expect(on).toMatch(/hűen mondd ki/);
    expect(on).toMatch(/ne mondd, hogy nem kaptál választ/);
    expect(on).toMatch(/ne kommentáld az eltérést/);
  });

  it('should keep real orders escalated but allow the demo order tool, saying that its data is made up', () => {
    expect(on).toMatch(/Meglévő rendelésről[^.]*magad nem válaszolsz/);
    expect(on).toMatch(/Kivétel[^.]*getOrderStatus[^.]*demó[^.]*kitalált adatot ad[^.]*ki kell mondanod/);
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
