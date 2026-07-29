// dontesek-hf3.md #2/#3: minden cikk (mind a 202) tartalmaz egy visszatérő
// "Perfect Pairings For Your Plants" termékajánló blokkot, amit közvetlenül
// egy "Words By The Sill" lábléc követ, egészen a dokumentum végéig — ez
// marketing/cégleírás tartalom, nem gondozási tudás, ezért chunkolás előtt
// kivágjuk.
const BOILERPLATE_SECTION_HEADING = '## Perfect Pairings For Your Plants';

/**
 * Cuts the recurring product-block + footer boilerplate (everything from
 * the "Perfect Pairings" heading to the end of the article body). Returns
 * the body unchanged if the heading isn't present.
 */
export function stripBoilerplate(body: string): string {
  const boilerplateIndex = body.indexOf(BOILERPLATE_SECTION_HEADING);
  if (boilerplateIndex === -1) {
    return body;
  }
  return body.slice(0, boilerplateIndex).trimEnd();
}
