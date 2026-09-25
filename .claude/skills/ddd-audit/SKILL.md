---
name: ddd-audit
description: A git history alapján ellenőrzi, hogy a docs/ddd/glossary.md és a docs/ddd/model.md naprakész-e a Plantbase domain-modelljéhez képest, és eltérés esetén frissíti vagy javasolja a frissítést. Akkor használd, ha a domain-modell változott — azaz módosult a products séma (packages/db/prisma/schema.prisma, a migrációk vagy a seed), vagy a hozzá kapcsolódó domain-fogalmak (pl. kategória, fényigény, öntözés, nehézség, akciós ár, háziállat-/gyerekbarát, vásárlói preferencia) jelentése, értékkészlete vagy a toolok/system prompt által használt szókincse; illetve ha a felhasználó DDD-glosszárium vagy domain-modell auditot kér.
---

# ddd-audit

Fejlesztői (L1) eszköz: a DDD-dokumentáció (`docs/ddd/glossary.md`, `docs/ddd/model.md`) és a tényleges domain-modell közötti eltérést keresi meg és szünteti meg. **Nem része a Plantbase terméknek** — nincs hozzá kód a `packages/`-ban, és a futásidejű agent sem használja.

## Szabályok

- **Csak a domain-modellt dokumentálod.** A doksi azt írja le, ami a kódban/sémában ténylegesen van — nem tervet, nem implementációs részletet (pl. tool-belső logikát, infrastruktúrát).
- **Üzleti döntést nem írsz felül, csak javasolsz.** Ha a doksiban rögzített üzleti szabály, definíció vagy döntés (pl. mi számít „kezdő” növénynek, mikor „akciós” egy termék) ellentmond a kódnak, NEM döntöd el, melyik a helyes: jelezd az eltérést, és javasolj megoldást a felhasználónak.
- Tisztán leíró, tényszerű eltérést (új/törölt/átnevezett mező, megváltozott értékkészlet, új fogalom) közvetlenül frissíthetsz.
- Ha kétséges, hogy egy eltérés leíró vagy üzleti döntés, kezeld üzleti döntésként → csak javaslat.

## Lépések

### 1. Nézd meg a git history változásait

- Határozd meg a kiindulópontot: a `docs/ddd/` utolsó módosító commitja
  `git log -1 --format=%H -- docs/ddd/`
  Ha még nincs ilyen (a könyvtár nem létezik), a teljes history számít.
- Listázd az azóta történt, domain-releváns változásokat:
  `git log --oneline <base>..HEAD -- packages/db/prisma/ packages/core/src/tools/ packages/core/src/agents/ docs/system-prompt.md docs/brs-plantbase.md`
  és a konkrét diffet: `git diff <base>..HEAD -- <ugyanezek>`
- Domain-forrásnak számít elsősorban:
  - `packages/db/prisma/schema.prisma` (a `Product` modell mezői és kommentben rögzített értékkészletei), migrációk, seed
  - a toolok Zod-sémái és leírásai (`packages/core/src/tools/*/`) — milyen fogalmakat tesznek ki a modell felé
  - a system prompt (`docs/system-prompt.md`) domain-szókincse
  - az üzleti követelmények (`docs/brs-plantbase.md`)

### 2. Vesd össze a docs/ddd/glossary.md + docs/ddd/model.md tartalmával

- `glossary.md`: minden domain-fogalom (magyar név, kódbeli azonosító, DB-oszlop, jelentés, megengedett értékek) szerepel-e, és egyezik-e a kóddal.
- `model.md`: az entitások, attribútumok, értékkészletek, kapcsolatok és invariánsok egyeznek-e a sémával.
- Keresd kifejezetten:
  - új mező/fogalom, ami a doksiból hiányzik
  - törölt vagy átnevezett mező, ami a doksiban még szerepel
  - megváltozott értékkészlet vagy típus (pl. új kategória, nullable-ség)
  - eltérő elnevezés ugyanarra a fogalomra (ubiquitous language sérülése) a séma, a toolok és a prompt között
- Ha a fájlok nem léteznek: javasold a létrehozásukat a jelenlegi séma alapján, vázlattal.

### 3. Ahol eltérés van, frissítsd vagy javasold a frissítést

- **Leíró eltérés** → frissítsd a megfelelő fájlt, minimális, célzott módosítással, a meglévő stílust és szerkezetet követve.
- **Üzleti döntést érintő eltérés** → ne módosíts; adj javaslatot.
- Zárásként adj rövid riportot:
  - vizsgált tartomány (`<base>..HEAD`) és a releváns commitok
  - elvégzett frissítések (fájl + mi változott)
  - javaslatok, döntésre várva (eltérés, forrás a kódban, javasolt szöveg)
  - ha minden naprakész, mondd ki egyértelműen.
- Ne commitolj automatikusan — a felhasználó dönti el, mikor és hogyan kerül be a változás.
