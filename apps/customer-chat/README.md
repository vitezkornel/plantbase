# customer-chat

Minimális, ügyfél felé forduló webes chat demo a meglévő Plantbase agenthez (`packages/core`), emberi jóváhagyási ponttal (eszkalációval) kiegészítve: ha az agent bizonytalan, vagy olyan témát érint a kérdés (rendelés, szállítás, számlázás, visszáru, reklamáció), amihez nincs adata, egyértelműen jelzi, hogy egy kolléga veszi át az ügyet, ahelyett hogy találgatna. Szándékosan PoC célú, gyors bemutatóhoz készült réteg — **nem termék-minőségű, tartós komponens** (nincs Nx-regisztrációja, nincs streaming, nincs teljes tesztlefedettsége).

## Előfeltételek

- A repo gyökeréből lefuttatott `pnpm install`.
- Docker (a Postgres adatbázishoz) — lásd a gyökér [README.md](../../README.md) "Indítás lépésről lépésre" szakaszát, ha még nincs felállítva a DB és a `.env`.

## Indítás

```bash
# Ha az adatbázis még nem fut:
docker compose up -d

# A chat-szerver indítása:
npx tsx apps/customer-chat/server.ts
```

Ezután nyisd meg a böngészőben: [http://localhost:3000](http://localhost:3000)

## Demó-kérdések

Két kimásolható kérdés a felülethez — egy normál (nem eszkalálódó) és egy biztosan eszkalálódó:

```
Hogyan gondozzak egy Monsterát?
```

```
Hol van a rendelésem, mikor érkezik meg?
```

## Ismert korlátok

- Nincs PII-szűrés a naplózásban (a `packages/core` JSONL-naplója a kérdést és a választ nyersen tárolja).
- Nincs hozzáférés-korlátozás a naplófájlon (fájlrendszer-szintű, nincs külön jogosultságkezelés).
- Nincs rate-limit vagy költségplafon az Anthropic/Cohere API-hívásokra.
- Nincs védelem prompt injection ellen.
