# Kérdéslap — felkészülés a vezetői kör kérdéseire

A demón nemcsak a cégvezető ül majd, hanem a "kötekedők" is: az IT-biztonsági vezető, a jogász és a területvezető. Ezekre a kérdésekre a saját, jelenleg futó PoC-ra mutató, őszinte válaszok — ahol van hiányosság, azt is felvállaljuk, a fejlesztési iránnyal együtt.

---

### 1. Milyen személyes adat kerül a rendszerbe, és hol tűnik el?

A rendszer alapból nem kér és nem tárol személyes adatot — amit "tud", az csak a növénykatalógus és a gondozási cikkek, semmi ügyféladat nincs bennük. Az egyetlen kockázat, hogy ha valaki a kérdésébe véletlenül beleírja a nevét vagy elérhetőségét, azt a rendszer ma még nem szűri ki a mentett előzményekből — ezt élesítés előtt be kell építeni.

### 2. Hol fut a modell, hova utazik az adat, mi marad nálunk?

A mesterséges intelligencia egy külső, felhő-alapú szolgáltatónál (Anthropic) fut — minden kérdés és a hozzá tartozó válasz odautazik feldolgozásra. Ami sosem hagyja el a saját rendszerünket: maga a teljes adatbázis és a teljes tudásbázis. Csak annyi megy ki, amennyi egy adott kérdés megválaszolásához kell — nem a teljes katalógus, csak egy pár soros kivonat belőle.

### 3. Melyik lépésnél hagy jóvá ember, mit lát, mit tud visszavonni?

Fontos tisztázni: ez nem úgy működik, hogy egy ember minden válasz előtt rábólint — a chat azonnal válaszol. Ehelyett a rendszer saját magától felismeri, ha egy kérdés olyan témát érint, amihez nincs jogosultsága vagy tudása (pl. rendelés-státusz), és ilyenkor nem próbál kitalálni egy választ, hanem azonnal jelzi, hogy egy kolléga veszi át. Kárt egyébként sem tud okozni: a rendszer az adatbázisból csak olvasni tud, módosítani, törölni soha — tehát a legrosszabb eset egy nem tökéletes válasz, nem egy elrontott adat.

### 4. Mi kerül naplóba, ki fér hozzá, meddig marad meg?

Minden beszélgetés el van mentve egy naplófájlba: a kérdés, a válasz, hogy volt-e kolléga-átirányítás, és hogy milyen adatforrásokat használt a rendszer a válaszhoz. Ma ez a napló egy sima fájlban van, hozzáférés-korlátozás és automatikus törlési szabály nélkül — ezt is be kell építeni, mielőtt élesbe megy.

### 5. Mi történik, ha a rendszer téved, és mennyi idő alatt áll helyre?

Mivel a rendszer semmit nem tud módosítani az adatbázisban (csak olvas), egy hibás válasz nem okoz tartós kárt — legfeljebb egy pontatlan információt ad, amit a kolléga-átirányítás jelentős részben eleve kiszűr. Ha valami mégis elromlana, a rendszer egyszerű leállítása és újraindítása percek alatt megoldja — nincs semmi, amit "vissza kellene állítani".

### 6. Ki a gazda bevezetés után, miből látja, hogy jól működik?

A rendszer gazdája bevezetés után az **ügyfélszolgálat vezetője** — ő látja a napi működést, és nála futnak össze az eszkalált esetek is. A "miből látja, hogy jól működik" kérdésre már van válaszunk: elkészült egy mérési terv, ami pontosan megmutatja, mit és hogyan kell figyelni — például hány kérdést old meg önállóan a rendszer, és hányszor kell embert bevonni.

---

### 7. (saját kérdés) Mi van, ha valaki szándékosan megpróbálja átverni a rendszert egy trükkös kérdéssel, hogy olyat mondjon, amit nem kellene?

Ma nincs erre külön, dedikált védelem beépítve — ez egy nyitott kockázat, amit tudunk és vállalunk. Ugyanakkor a rendszer felépítése miatt a legrosszabb eset is korlátozott: mivel az adatbázisból csak olvasni tud, semmit módosítani nem, még egy sikeres "átverés" esetén sem tud kárt okozni, legfeljebb egy nem odaillő választ ad. A megoldás iránya egyértelmű, ha ez prioritás: egy külön ellenőrző réteg beépítése, ami a választ elküldés előtt átnézi, hogy nem tér-e el a rendszer a saját szabályaitól — ez egy jól ismert, bevett technika, amit a következő fejlesztési körben be lehet vezetni.

### 8. (saját kérdés) Mi történik a költségekkel, ha ezerszer ennyi kérdés jönne be?

Minden egyes kérdés pénzbe kerül (a mesterséges intelligencia használata díjköteles), és ma nincs beépítve felső korlát — nagy forgalom esetén a költség egyelőre arányosan nőne, korlátozás nélkül. Ez egy egyszerűen orvosolható hiányosság: be lehet állítani egy napi/havi költségplafont, illetve egy limitet arra, hogy egy felhasználó percenként/óránként hány kérdést tehet fel — ezek bevett, gyorsan bevezethető biztonsági hálók, csak eddig, a PoC-fázisban nem voltak prioritások.
