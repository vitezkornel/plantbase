// dontesek-hf3.md #2/#3: minden cikk (mind a 202) tartalmaz egy visszatérő
// "Perfect Pairings For Your Plants" termékajánló blokkot, amit közvetlenül
// egy "Words By The Sill" lábléc követ, egészen a dokumentum végéig — ez
// marketing/cégleírás tartalom, nem gondozási tudás, ezért chunkolás előtt
// kivágjuk.
const BOILERPLATE_SECTION_HEADING = '## Perfect Pairings For Your Plants';

// A chunk-article.ts fejlesztése közben felfedezett második minta: az
// "ask-the-sill" rovat ###### tagline-je ("...Chrissy will set you up with
// the perfect plant pick") 22 cikkben ismétlődik, néhány apró szövegezési
// változattal (pl. "plant specialist" vs. "customer happiness team lead
// Chrissy") — ezért nem egzakt string-egyezéssel, hanem egy stabil,
// mindegyik változatban megjelenő rész-mondat alapján szűrjük ki. Ha
// heading-alapú chunkolás vágná szét a cikket, ez a sor önálló, ~22-szer
// szinte azonos "chunk" lenne — ugyanaz a zaj-probléma, mint a lábléc.
const RECURRING_TAGLINE_MARKER =
  'will set you up with the perfect plant pick';

/**
 * Cuts the recurring product-block + footer boilerplate (everything from
 * the "Perfect Pairings" heading to the end of the article body), and any
 * line carrying the recurring "Ask The Sill" column tagline. Returns the
 * body unchanged if neither pattern is present.
 */
export function stripBoilerplate(body: string): string {
  const boilerplateIndex = body.indexOf(BOILERPLATE_SECTION_HEADING);
  const withoutFooter =
    boilerplateIndex === -1 ? body : body.slice(0, boilerplateIndex).trimEnd();

  return withoutFooter
    .split('\n')
    .filter((line) => !line.includes(RECURRING_TAGLINE_MARKER))
    .join('\n');
}
