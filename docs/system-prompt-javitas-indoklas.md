# system-prompt.md — minőségi javítások indoklása

> Ez a dokumentum a `docs/system-prompt.md` (és a vele szinkronban tartott `packages/core/src/agents/ask-agent/ask-agent-prompt.ts` mirror) 4 pontos minőségi javítását dokumentálja: mi volt előtte, mit változtattunk, és miért.

## (a) Eredeti állapot

A B Fázis 3 (`runSql` tool) óta a system prompt XML-szerű tagekre épült, ebben a sorrendben:

```
<role> <task> <schema> <rules> <behavior> <tools>
```

- `<rules>`: az SQL-generálás kemény szabályai (csak SELECT, LIMIT, ILIKE, COALESCE az árhoz, stb.).
- `<behavior>`: a válasz stílusára vonatkozó puha irányelvek (kérdezz vissza kétértelmű kérdésnél, emeld ki a fontos attribútumokat, légy tömör).
- `<tools>`: a `runSql` és (a `listCategories` tool bevezetése óta) a `listCategories` leírása.

Nem volt benne:
- Konkrét kérdés → SQL/tool-hívás mintapélda.
- Explicit korlát arra, hány tool-hívást tehet az agent egy válaszon belül.
- Szabály arra, mit tegyen a modell, ha egy lekérdezés sok sort ad vissza.
- Szabály a pénzösszegek (Ft) megjelenítési formátumára.

## (b) Mit változtattunk

Mind a `docs/system-prompt.md`, mind az `ask-agent-prompt.ts` XML-tartalma azonos módon módosult (a meglévő szinkron-szabály szerint: a doksi az elsődleges, a `.ts` szó szerinti mirror).

1. **Új `<constraints>` tag**, a `<rules>` után, a `<tools>` elé:
   ```
   <constraints>
   - Egy válaszon belül legfeljebb 3 tool-hívást tehetsz összesen (runSql és listCategories együtt számít). A 3. hívás eredménye után a rendelkezésre álló adatokból foglald össze a választ — ne próbálkozz tovább, és ne ismételd meg ugyanazt a lekérdezést.
   </constraints>
   ```

2. **Két új `<behavior>` bullet**, a meglévők közé illesztve (nem a végére, hanem a tartalmilag rokon szabály mellé):
   - "Az árakat mindig magyar ezres-tagolással és „Ft" felirattal írd ki (pl. „12 990 Ft"), soha ne nyers szám formában (pl. „12990")." — az "emeld ki a döntéshez fontos attribútumokat: ár..." bullet után, mert mindkettő az árprezentációról szól.
   - "Ha a lekérdezés sok sort ad vissza (pl. a LIMIT miatt 10-nél több találat), csak a legjobb/legrelevánsabb 3-5 találatot emeld ki konkrétan; a többit egy mondatban összegezd (pl. „és további 12 hasonló található, szólj ha ezeket is részletezzem")." — a "Légy tömör" bullet után, mert ez annak konkrét kifejtése.

3. **Új `<examples>` tag**, a `<tools>` után (hogy mire a modell odaér, már ismeri a sémát, a szabályokat és az elérhető toolokat is):
   ```
   <examples>
   <example><question>Milyen kaktuszaitok vannak?</question><sql>...</sql></example>
   <example><question>Napos ablakpárkányra ajánlanál egy 5000 Ft alatti növényt?</question><sql>...</sql></example>
   <example><question>Milyen kategóriák vannak a katalógusban?</question><action>listCategories() — ne írj SQL-t erre...</action></example>
   </examples>
   ```
   A három példa egyenként más-más mintát mutat: (1) egyszerű, egy-oszlopos kategória-szűrés, (2) több szűrő kombinálása (fény lista + COALESCE-alapú büdzsé-szűrés + raktárkészlet + rendezés), (3) mikor NEM SQL-t kell írni, hanem a `listCategories` toolt kell hívni.

Nem változott: `<role>`, `<task>`, `<schema>`, a meglévő `<rules>` és `<behavior>` bulletek, illetve a `<tools>` leírásainak szövege.

## (c) Miért — indoklás pontonként

**1. `<examples>` hozzáadása.**
LLM-eknél a few-shot példák a leghatékonyabb eszközök a kimenet konzisztenciájának növelésére és a hallucináció csökkentésére, különösen többszűrős, kombinált feltételeket igénylő lekérdezéseknél — a puszta szöveges szabály ("Ár: COALESCE(sale_price, price)... Büdzsénél ezzel számolj") megérthető, de a modell könnyebben hibázik (pl. elfelejti a `stock > 0`-t, vagy nem a `COALESCE`-re rendez), ha nincs konkrét minta, ami mindezt egyszerre mutatja be. A 3. példa (`listCategories`) kifejezetten azt a hibamódot célozza, hogy a modell kategória-kérdésre ne írjon felesleges, esetleg hibás `SELECT DISTINCT` SQL-t a már létező, dedikált tool helyett. Élőben tesztelve: egy 5 szűrős kérdésre ("kezdőbarát, ritkán öntözendő, erős fényt/direkt napot kedvelő, ≤3000 Ft, raktáron van") a generált SQL mind az 5 feltételt helyesen, a mintapéldák stílusában kombinálta (`difficulty = 'kezdő' AND watering = 'ritka' AND light IN (...) AND COALESCE(sale_price, price) <= 3000 AND stock > 0 ORDER BY COALESCE(...) ASC`).

**2. Válasz-tömörség szabály sok találatnál.**
A `runSql` alapból 20-50 soros `LIMIT`-tel dolgozik — ha a modell mind a 20-50 sort felsorolná a válaszban, az olvashatatlan, "nyers tábla-dump" lenne (amit a régi "Légy tömör" szabály már tiltott, de nem mondta meg konkrétan, *hogyan* legyen tömör sok találatnál). A pontosított szabály ("3-5 legjobb, a többit egy mondatban") megadja a konkrét mintát, ami determinisztikusabb, konzisztensebb válaszformátumot eredményez, és jobb UX-et ad egy lakberendezőnek, aki gyorsan akar dönteni, nem egy nyers listát bogarászni. Élőben tesztelve: egy "mutasd meg az összes raktáron lévő növényt" kérdésre (30 találat) a válasz pontosan 5 kiemelt tételt sorolt fel konkrétan, a maradék 25-öt egy összefoglaló mondatban kezelte kategóriák szerint.

**3. Tool-hívás-korlát (`<constraints>`).**
Az `agent-loop.ts` már eddig is véd egy technikai `MAX_ITERATIONS = 6` korláttal a végtelen ciklus ellen (kivétellel dob, ha túllépi) — ez egy *hard*, kódszintű biztonsági háló, ami hibaüzenetet eredményez, ha a modell tényleg elszalad. A promptbeli 3-as korlát ennél megelőző jellegű: azt szeretnénk, hogy a modell *saját magától*, jóval a hard cap előtt abbahagyja a próbálkozást, és a meglévő adatokból értelmes választ adjon, ahelyett hogy feleslegesen ismételné/finomítaná a lekérdezést (ami lassabb és drágább is token-fogyasztás szempontjából). Ezzel elkerülhető, hogy egy bizonytalan modell 5-6 körön át próbálkozzon, mielőtt a hard cap kidobná — a promptbeli korlát így költség- és válaszidő-optimalizálás, nem csak biztonsági kérdés.

**4. Magyar számformázás szabálya.**
A demókban és éles használatban a felhasználó (lakberendező vagy háztartás) magyar nyelvű, magyar szokás szerint tagolt árakat vár ("12 990 Ft"), nem nyers adatbázis-számot ("12990"). Enélkül a szabály nélkül a modell viselkedése esetleges volt (van, hogy helyesen tagolt, van, hogy nem) — a válasz professzionalitása és olvashatósága múlik ezen egy webshop-kontextusban. Élőben tesztelve: mindkét demókérdésre adott válasz konzisztensen tagolt formátumot használt (pl. „890 Ft", „1 490 Ft", „13 990 Ft").

## Élő tesztek összefoglalója

| Teszt | Kérdés | Amit igazolt |
|---|---|---|
| Többszűrős SQL | "kezdőbarát, ritkán öntözendő, erős fényt/direkt napot kedvelő, ≤3000 Ft, raktáron van" növény | `<examples>` hatására mind az 5 szűrő helyesen, a bevált COALESCE/stock/ORDER BY mintát követve került az SQL-be |
| Tömörség sok találatnál | "Mutasd meg az összes raktáron lévő növényt" (30 találat) | A válasz 5 konkrét kiemelést adott, a maradék 25-öt egy mondatban összegezte; az árak mind helyesen (ezres tagolással, "Ft" felirattal) jelentek meg |

Mindkét teszt a valós, élesen futó `askAgent`-en keresztül történt (nem mockolt kliens), a `logs/*.jsonl` bejegyzések a generált SQL-lel és a tényleges DB-eredménnyel együtt visszakereshetők.
