# Mérési terv — Plantbase ügyfél-chat PoC

A tábla azt mutatja meg, honnan tudjuk, hogy az ügyfél felé forduló chat-asszisztens ténylegesen működik-e — nem csak a bemutató pillanatában, hanem folyamatosan, éles használat közben. Minden sorhoz megjelöltük, hogy az adat **ma, a PoC-ból már elérhető**, vagy **még be kell építeni**.

| Mit mérünk | Honnan lesz adat | Hogyan riportáljuk | Kinek | Státusz |
|---|---|---|---|---|
| Válaszidő (kérdés → válasz) | agent-napló (JSONL), a kérés és a válasz timestamp-je közti különbség | heti automatikus összesítő (átlag, p95) | folyamatgazda | **Ma is megvan** — minden interakció naplózva |
| Eszkalációs arány (hány kérdés kerül emberhez) | az `escalated` flag a naplóban, a napi interakciók arányában | heti/havi trend, a vezetői riportban egy dia | szponzor | **Ma is megvan** — ez a hiba-oldali metrika: azt méri, mikor *nem* old meg valamit a rendszer, nem csak a sikert |
| Eszkaláció oka (téma vs. bizonytalanság) | a naplóban rögzített nyers modellválasz alapján kategorizálható (rendelés/szállítás témák vs. "nincs releváns forrás" esetek) | havi bontás, hogy lássuk, melyik eszkalációs ok a gyakoribb | folyamatgazda | **Ma is megvan** a nyers adat, a kategorizálás (riport-szintű összesítés) még kézi/beépítendő lépés |
| Önkiszolgálással lezárt gondozási kérdések aránya (nem eszkalált, nem téves) | a naplóban: nem-eszkalált válaszok száma / összes gondozási témájú kérdés | havi összesítő, a "válasszal lezárva" fő üzleti mutató | szponzor | **Ma is megvan** — ez az 1. és 2. fájdalomponthoz (0–24 elérhetőség, ismétlődő kérdések) kötődő fő sikermutató |
| Forrás nélküli (hallucinált) gondozási állítás aránya | ma a system prompt szabályozza ("soha ne találj ki gondozási tanácsot forrás nélkül"), de nincs hozzá automatikus ellenőrzés | mintavételes, kézi review (pl. heti 20 véletlenszerű beszélgetés átnézése) amíg nincs automatikus eszköz | folyamatgazda | **Be kell építeni** — javaslat: a válasz és a `searchKnowledge` találat automatikus összevetése (pl. LLM-as-judge), később |
| Ismétlődő témák aránya (mely kérdések a leggyakoribbak) | a kérdések szövegének kategorizálása (pl. öntözés, fény, kártevő) | havi Top 10 téma lista | folyamatgazda | **Be kell építeni** — ma a napló tárolja a nyers kérdést, de nincs automatikus témacímkézés hozzá |

**Minimumkövetelmények ellenőrzése:**
- Legalább egy metrika a megoldott fájdalmakhoz kötődik → *önkiszolgálással lezárt kérdések aránya* (1., 2. fájdalompont).
- Legalább egy metrika az agent hibáját/korlátját méri, nem csak a sikerét → *eszkalációs arány* és *forrás nélküli állítás aránya*.
- Minden sorhoz van forrás vagy explicit jelölve, mit kell hozzá beépíteni.
