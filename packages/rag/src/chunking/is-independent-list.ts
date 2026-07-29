// dontesek-hf3.md #9: az eredetileg tervezett "bold cím + hasonló hosszú
// elemek" jel megbukott a valós Minta B-n ("Steps to pot your plant" is
// bold-számozott, hasonló hosszú elemekből áll, mégis EGYBEN tartandó,
// mert szekvenciális lépéssor). A tényleges megkülönböztető jel a
// szekció-cím (és a cikk-cím) SZEMANTIKÁJA, nem a lista elemeinek
// formázása.

// Legmagasabb bizalmú jel: ha az alcím procedurális ("csináld ezt a
// lépéseket") — akkor összefüggő, FÜGGETLENÜL attól, hogy a cikk címe
// egyébként listicle-mintát követ (ld. "lets the procedural heading
// signal win" teszt).
const PROCEDURAL_HEADING_PATTERN = /\b(steps?|how to|guide to)\b/i;

// Cikk cím vagy alcím "N legjobb/top N" mintája → független katalógus
// (Minta C: "10 Best Plants for Beginner Gardeners" / "10
// Beginner-Friendly Plants").
const NUMBERED_SUPERLATIVE_PATTERN =
  /\b\d+\b[^\n]*\b(best|top|beginner|favorite|favourite)\b/i;

// Kérdés-alakú alcím, ami többesszámú kategórianévvel zárul → független
// katalógus (Minta D beágyazott listája: "What are some easy low light
// tolerant plants?").
const ENUMERATIVE_QUESTION_PATTERN =
  /\b(what|which)\b[^\n]*\bare\b[^\n]*\bsome\b[^\n]*\w+s\??\s*$/i;

export interface ListContext {
  articleTitle: string;
  sectionHeading: string;
}

/**
 * Decides whether a numbered list under a heading is a set of
 * INDEPENDENT, catalog-like items (split into one chunk per item) or a
 * single COHERENT sequence/process (kept as one chunk) — see
 * dontesek-hf3.md #4-#7, #9 for the evidence behind each rule.
 */
export function isIndependentList({
  articleTitle,
  sectionHeading,
}: ListContext): boolean {
  if (PROCEDURAL_HEADING_PATTERN.test(sectionHeading)) {
    return false;
  }
  if (
    NUMBERED_SUPERLATIVE_PATTERN.test(articleTitle) ||
    NUMBERED_SUPERLATIVE_PATTERN.test(sectionHeading)
  ) {
    return true;
  }
  if (ENUMERATIVE_QUESTION_PATTERN.test(sectionHeading)) {
    return true;
  }
  return false;
}
