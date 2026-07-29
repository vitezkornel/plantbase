# HF3 — Golden set: nyers vektorkeresés vs. teljes pipeline

Ez a dokumentum a HF3 4. pontjának ("Golden set — bizonyítsd, hogy a
pipeline csinál valamit") leadandója: 8 kérdés (7 pozitív + 1 negatív
teszt) a saját domainből (növénygondozás), mindegyik lefuttatva kétféle
módon, és összevetve.

## Módszertan

- **Nyers vektorkeresés:** a magyar kérdés közvetlen Cohere-embeddingje
  (`search_query` input type), majd `ORDER BY embedding <=> $1::vector
  LIMIT 5` a `knowledge_chunks` táblán — nincs HyDE, nincs rerank.
- **Teljes pipeline:** a `searchKnowledge` tool tényleges útja — HyDE
  (Claude Haiku angol hipotetikus bekezdést generál a magyar kérdésből,
  ld. `rag-proposal.md` #6) → Cohere embed → vektorkeresés (top-20) →
  Cohere rerank az eredeti magyar kérdés ellenében (top-5).
- A 8 kérdést úgy választottuk, hogy lefedje a `dontesek-hf3.md`-ben
  azonosított cikk-mintákat (Q&A, lépéssor, független lista, mély
  útmutató+FAQ, glosszárium-jellegű fogalom-magyarázat, kártevő-cikk) —
  ne csak egy típusú tartalmon teszteljünk.
- A 8. kérdés szándékosan **negatív teszt**: egy plauzibilis, de a 202
  cikk között garantáltan nem szereplő téma (ellenőrizve: `grep -riE
  "tomato|vegetable|hydropon"` nulla találatot ad a `data/knowledge`
  alatt).
- Minden találatnál feltüntetjük a cikk címét és a szekció-utat
  (`sectionPath`); a nyers keresésnél a pgvector cosine-távolságot
  (`distance`, kisebb = közelebb), a pipeline-nál a Cohere rerank
  relevancia-score-ját (`score`, nagyobb = relevánsabb) — a két szám
  **nem ugyanazon a skálán van**, egymás közt nem hasonlítható
  közvetlenül, csak a saját oszlopán belüli sorrend/nagyságrend számít.

---

## Eredmények kérdésenként

### Q1 — "Hogyan gondozzak egy Meyer citromfát?"

*(Minta E: mély, egy-növényes útmutató)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | Meyer Lemon :: soil/fertilizer (0.597) | Meyer Lemon :: At a Glance (0.934) |
| 2 | Meyer Lemon :: light (0.605) | Meyer Lemon :: indoor vs outdoor (0.925) |
| 3 | Meyer Lemon :: At a Glance (0.614) | Meyer Lemon :: watering (0.885) |
| 4 | Meyer Lemon :: watering (0.635) | Meyer Lemon :: light (0.877) |
| 5 | Meyer Lemon :: humidity (0.661) | Meyer Lemon :: soil/fertilizer (0.876) |

**Értékelés:** mindkét módszer kizárólag a helyes cikkből hoz találatot —
ez egy lexikailag "könnyű" kérdés (a kérdés szinte szó szerint tartalmazza
a cikk tárgyát). A pipeline az "At a Glance" gyors-összefoglalót teszi
előre, ami jobb belépőpont egy általános gondozási kérdésre.

### Q2 — "Miért sárgulnak a szobanövényem levelei?"

*(care-miscellaneous, önálló cikk — konkrét rerank/HyDE-bizonyíték, ld. lent)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | Canela Tree :: Humidity (0.730) — **irreleváns** | 5 Causes for Yellow Leaves :: Whole Plant Yellowing (0.892) |
| 2 | 5 Causes for **Browning** Leaves :: Why Leaves Turn Brown (0.750) — **rossz cikk** | 5 Causes for Yellow Leaves :: Why Leaves Turn Yellow (0.890) |
| 3 | Plant Care for Large Plants :: Leaf Cleaning (0.754) — **irreleváns** | 5 Causes for Yellow Leaves :: Conclusion (0.835) |
| 4 | Winter Plant Care Tips :: Dust Off Leaves (0.758) — **irreleváns** | 5 Causes for Yellow Leaves :: Only Mature Leaves (0.835) |
| 5 | Fall Plant Care Tips :: Foliage Dieback (0.761) — **irreleváns** | 5 Causes for Yellow Leaves :: Bright Yellow/Mushy Stems (0.831) |

**Lásd lent a "Konkrét bizonyíték" szakaszban.**

### Q3 — "Milyen könnyen gondozható növényeket ajánlanál kezdőknek alacsony fényviszonyok közé?"

*(Minta D: beágyazott listicle — konkrét rerank/HyDE-bizonyíték, ld. lent)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | 10 Best Plants for Beginner **Gardeners** :: Spartan Juniper (0.627) — **kültéri, irreleváns** | Easy Indoor Plants...Low Light :: mely növények (0.956) |
| 2 | ua. :: Peggy Martin Rose (0.638) — **kültéri, irreleváns** | 10 Best Low Light Indoor Plants :: Pothos (0.922) |
| 3 | ua. :: Japanese Maples (0.647) — **kültéri, irreleváns** | 10 Best Low Light Indoor Plants :: bevezető (0.921) |
| 4 | ua. :: Bonfire Patio Peach Tree (0.652) — **kültéri, irreleváns** | The Ultimate Low Light Plant :: Q&A (0.917) |
| 5 | Top Five Flowering Vines :: Star Jasmine (0.655) — **irreleváns** | 10 Best Low Light Indoor Plants :: ZZ Plant (0.916) |

**Lásd lent a "Konkrét bizonyíték" szakaszban.**

### Q4 — "Hogyan ültessem át a szobanövényemet a nevelőcserépből saját cserépbe?"

*(Minta B: sorozatos lépéssor)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | Moving Plants :: Moving Small Plants (0.781) — **félrevezető (költözés)** | Grow Pot vs Planter :: Steps to pot (0.939) |
| 2 | Grow Pot vs Planter :: We've got you (0.781) | How To Repot Houseplant :: Steps to Repot (0.918) |
| 3 | Grow Pot vs Planter :: How to pot your plant (0.784) | How to Pot Step By Step :: Steps to Pot (0.913) |
| 4 | Bulb Lasagna :: Step 5 Water and Wait (0.787) — **irreleváns (hagyma)** | How to Pot Step By Step :: Potting for Beginners (0.894) |
| 5 | 2025 Plant Trend Report :: (preamble) (0.788) — **irreleváns** | How To Repot Houseplant :: bevezető (0.880) |

**Értékelés:** a nyers keresés zajos (költözés, hagymaültetés keveredik
be), a pipeline mind az 5 helyen ténylegesen a lépéssoros átültetési
útmutatókból hoz találatot, 3 különböző cikkből — jobb lefedettség és
pontosság egyaránt.

### Q5 — "Milyen növényeket ajánlanál kezdő kertészeknek a kertbe?"

*(Minta C: független listicle)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | 10 Best Plants for Beginner Gardeners :: Japanese Maples (0.676) | 10 Best Plants for Beginner Gardeners :: June Hosta (0.910) |
| 2 | ua. :: Spartan Juniper (0.680) | ua. :: Japanese Maples (0.907) |
| 3 | ua. :: Bonfire Patio Peach Tree (0.685) | ua. :: Phenomenal™ Lavender (0.897) |
| 4 | ua. :: Peggy Martin Rose (0.688) | ua. :: Roseum Pink Rhododendron (0.878) |
| 5 | Citrus Tree Care Guide :: Choosing the Right Citrus Tree (0.704) — **irreleváns** | ua. :: Spartan Juniper (0.873) |

**Értékelés:** mindkét módszer megtalálja a helyes cikket, a pipeline
valamivel tisztább (nincs benne az 5. helyen a nyersnél megjelenő
irreleváns Citrus Tree Care Guide).

### Q6 — "Hogyan szabaduljak meg a pajzstetvekről a szobanövényeimen?"

*(kártevő-cikk — **a pipeline korlátja, nem szépítve**, ld. lent)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | How to Clean Houseplant Leaves :: Damp cloth (0.748) — **irreleváns** | Bug Off: Mealybugs :: At a Glance (0.908) — **rossz kártevő** |
| 2 | Winter Blues Tips :: Soak up the sun (0.756) — **irreleváns** | Bug Off: Mealybugs :: Getting Rid of (0.901) — **rossz kártevő** |
| 3 | Bug Off: Fungus Gnats :: Getting Rid of (0.757) — **rossz kártevő** | Bug Off: Spider Mites :: Getting Rid of (0.900) — **rossz kártevő** |
| 4 | Winter Blues Tips :: Get some plants (0.759) — **irreleváns** | Common Citrus Tree Pests :: Scale Insects (0.852) — **✓ helyes kártevő** |
| 5 | Bug Off: Mealybugs :: At a Glance (0.759) — **rossz kártevő** | Bug Off: Scale :: Getting Rid of Scale Bugs (0.845) — **✓ helyes kártevő** |

**Lásd lent a "Korlát, amit nem szépítünk" szakaszban.**

### Q7 — "Mit jelent az, hogy egy növény 'alacsony fényt tűrő'?"

*(fogalom-magyarázat — konkrét rerank/HyDE-bizonyíték, ld. lent)*

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | Key Plant Terms Glossary :: Bright Light/Direct Sun (0.678) — **ellenkező irány** | Easy Indoor Plants...Low Light :: What is a low light plant? (0.910) |
| 2 | Lighting Guide :: Light Bright (0.690) | Lighting Guide :: Light Bright (0.816) |
| 3 | Lighting Guide :: Quantity (0.694) | 10 Best Low Light Indoor Plants :: bevezető (0.725) |
| 4 | Growth Spurts :: Seasonality (0.708) — **irreleváns** | The Ultimate Low Light Plant :: bevezető (0.689) |
| 5 | Easy Indoor Plants...Low Light :: What makes a plant suited for low light? (0.714) | Easy Indoor Plants...Low Light :: How do you care for low light plants? (0.665) |

**Lásd lent a "Konkrét bizonyíték" szakaszban.**

### Q8 — NEGATÍV TESZT: "Milyen tápoldatot használjak a paradicsom hidroponikus termesztéséhez?"

| # | Nyers (distance) | Pipeline (score) |
|---|---|---|
| 1 | Click and Grow Smart Garden 3 :: How does it work? (0.686) | Orchid Rebloom :: Get fertilizing (**0.509**) |
| 2 | Potting Mix 101 :: What media should you use? (0.723) | Pothos Care :: Fertilizer (**0.498**) |
| 3 | Silver Satin :: Humidity (0.724) | Rubber Tree Care :: Fertilizer (**0.498**) |
| 4 | Petite Knock Out Rose :: Humidity (0.724) | Bird of Paradise :: Fertilizer (**0.482**) |
| 5 | Majesty Palm :: Soil (0.733) | Plant Care: Fertilizer :: How to Choose? (**0.474**) |

**Lásd lent a "Negatív teszt" szakaszban.**

---

## Konkrét bizonyíték: a HyDE + rerank érdemben átrendezte/javította a találatokat

### Q2 — a legerősebb példa

A nyers vektorkeresés a magyar "sárgul" szót láthatóan összemosta a
"barnul"/általános levélgond fogalmakkal: a top-5-ből **négy teljesen
irreleváns** (Canela Tree páratartalma, nagy növények levéltisztítása,
téli porleverés, lombhullás), a 2. helyen pedig egy **másik, rossz témájú
cikket** hoz ("5 Causes For Your Plant's Browning Leaves" — barnulás, nem
sárgulás). A helyes cikk ("5 Causes For Your Plant's **Yellow** Leaves")
a nyers top-5-ben **egyáltalán nem szerepel**.

A teljes pipeline-nál a HyDE-lépés egy angol, "yellowing leaves"-specifikus
hipotetikus bekezdést generált a magyar kérdésből, ami pontosan a helyes
cikk szemantikai terébe navigált: mind az 5 pipeline-találat a helyes
"5 Causes For Your Plant's Yellow Leaves" cikk különböző szekciója.

**Miért jobb az új sorrend:** a nyers keresés válasza a felhasználónak
semmit nem mondott volna a sárgulás okairól (téves cikkeket idézett
volna); a pipeline válasza pontosan a kérdezett problémára ad forrást.

### Q3 — hasonlóan erős példa

A nyers keresés a "kezdőknek" szóra futott rá, és **kültéri kerti
növényeket** (Japanese Maple, Spartan Juniper, rózsa) ajánlott — teljesen
figyelmen kívül hagyva a "beltéri" és "alacsony fény" megkötést. A teljes
pipeline mind az 5 helyen a helyes, beltéri, alacsony fényt tűrő növény
cikkeket hozta ("Easy Indoor Plants That Can Survive Low Light", "10 Best
Low Light Indoor Plants").

**Miért jobb az új sorrend:** a nyers válasz a felhasználónak kültéri
növényeket ajánlott volna egy explicit beltéri/alacsony fényes kérdésre —
ez használhatatlan válasz lett volna. A pipeline helyesen szűkítette a
keresést a releváns alkategóriára.

### Q7 — finomabb, de valós javulás

A nyers keresés #1 találata ("Bright Light / Direct Sun / High Light"
glosszárium-bejegyzés) **az ellenkező fogalmat** magyarázza, mint amit a
kérdés keres. A pipeline #1 találata ("What is a low light plant?")
pontosan a kérdezett fogalom definíciója.

**Miért jobb az új sorrend:** a nyers válasz a felhasználót összezavarta
volna (a "sok fény" fogalmát magyarázta volna "kevés fény" helyett); a
pipeline a helyes definíciót adja elsőként.

---

## Korlát, amit nem szépítünk: Q6

A pipeline **javított** a nyers keresésen (a nyers top-5-ből 4 teljesen
irreleváns, a pipeline mind az 5 helyen legalább kártevő-irtási cikket
hoz), de **nem tökéletes**: a kérdezett konkrét kártevő (pajzstetű/"scale")
cikke csak a 4–5. helyen jelenik meg, az 1–3. helyen más kártevők
(mealybugs, spider mites) "Bug Off" cikkei szerepelnek — feltehetően
azért, mert ezek a cikkek szerkezetileg és szókincsileg nagyon hasonlóak
egymáshoz (mindegyik "Bug Off: All About X" sablon), és a magyar
"pajzstetű" szó embeddingje nem különült el elég élesen a rokon
kártevő-nevektől ("mealybugs", "spider mites") a HyDE-bekezdésben sem.

**Tanulság:** a rerank/HyDE nem old meg mindent — egy erősen sablonos,
egymáshoz hasonló szerkezetű cikk-család (itt: "Bug Off" sorozat) esetén a
finomhangolás (pl. a HyDE-promptban explicit kérni a kártevő angol nevének
pontos megnevezését) további javítást hozhatna. Ezt a HF3 leadásban is
korlátként, nem hibaként dokumentáljuk: a golden set pontosan azért
hasznos, mert az ilyen határeseteket is felszínre hozza.

---

## Negatív teszt: Q8

**A tudásbázisban nincs paradicsom-/hidroponika-tartalom** (ellenőrizve:
`grep -riE "tomato|vegetable|hydropon" data/knowledge/` nulla találat).

**Mennyiségi jel:** a pipeline rerank relevancia-score-jai ennél a
kérdésnél **0.47–0.51** — minden más (pozitív) kérdésnél a top-5
score-tartomány **0.66–0.96** volt. Ez egy tiszta, számszerű különbség,
ami elvben egy relevancia-küszöb alapú szűrésre is alapot adhatna, de a
HF3-implementációban ehelyett a **modellre** bíztuk a döntést (a system
prompt explicit szabálya: "Ha a searchKnowledge nem ad releváns találatot...
mondd ki egyértelműen, hogy a tudásbázisban nincs erre vonatkozó
információ").

**A tényleges agent-válasz** (valós `askAgent()` hívás, Claude Sonnet,
nem csak a tool kimenete) erre a kérdésre:

> A tudásbázisban sajnos nem találtam kifejezetten a paradicsom
> **hidroponikus termesztéséhez** szóló, specifikus tápoldat-receptet vagy
> útmutatót. A találatok általános szobanövény-tápoldatozási tanácsok
> (N-P-K arányokról), amelyek nem paradicsomra vagy hidroponikus
> rendszerre vonatkoznak:
>
> - **"Plant Care: Fertilizer"** (thesill.com/blogs/care-miscellaneous/plant-care-fertilizer)
> - **"How to Fertilize Your Houseplants"** (thesill.com/blogs/care-miscellaneous/how-to-fertilize-your-houseplants)
>
> Ezek alapján annyi általánosságban elmondható, hogy a magasabb foszfor
> (P) arányú tápoldat segíti a virágzást és termésfejlődést, ami
> paradicsomnál is releváns szempont lehetne, de **konkrét hidroponikus
> paradicsom-tápoldat receptre vagy EC/pH értékekre vonatkozó adatunk
> nincs a tudásbázisban** — ezt nem szeretném kitalálni.
>
> Ha szeretnéd, segítek inkább a katalógusunkban paradicsom vagy
> fűszernövény típusú termékeket keresni, vagy általános öntözési/fény
> tanácsot adni egy adott növényhez.

**Értékelés:** ez a HF3 grounding-elvárásánál ("mutasd be, hogy az agent
ezt ki is mondja, forráskitalálás helyett") kifinomultabb, jobb
viselkedés egy nyers "nem tudom"-nál: a modell helyesen különbséget tesz
a **lazán kapcsolódó, ténylegesen megtalált** tartalom (általános
tápoldat-cikkek, forrással idézve) és a **konkrétan hiányzó** tartalom
(hidroponikus paradicsom-specifikus recept) között, és az utóbbit
explicit nem találja ki. A grounding és a negatív-válasz szabály együtt
működik.

---

## Összegzés

| Kérdés | Nyers minőség | Pipeline minőség | Rerank/HyDE hatása |
|---|---|---|---|
| Q1 (Meyer citrom) | jó | jó | kismértékű javulás |
| Q2 (sárguló levelek) | **rossz** (4/5 irreleváns) | kiváló (5/5 helyes cikk) | **drámai javulás** |
| Q3 (alacsony fény, kezdő) | **rossz** (kültérire ugrott) | kiváló | **drámai javulás** |
| Q4 (átültetés lépései) | közepes (zajos) | jó (fókuszált) | érdemi javulás |
| Q5 (kerti kezdő növények) | jó | jó | kismértékű javulás |
| Q6 (pajzstetű) | **rossz** | közepes (jó kategória, rossz konkrét kártevő) | javulás, de nem tökéletes |
| Q7 (fogalom-magyarázat) | közepes (ellenkező fogalom #1) | jó (helyes definíció #1) | érdemi javulás |
| Q8 (negatív teszt) | zajos, alacsony jelentőségű | alacsony score, agent helyesen elutasítja a kitalálást | grounding bizonyítva |

A 7 pozitív kérdésből ötnél a HyDE+rerank érdemben vagy drámaian jobb
találatokat adott, kettőnél a nyers keresés is elfogadható volt (a
pipeline ekkor is legalább egyenrangú vagy kicsit tisztább). A negatív
teszt megmutatta, hogy a rendszer helyesen ismeri fel, amikor nincs a
kérdésre releváns tartalom, és ezt a végső agent-válasz is helyesen,
forráskitalálás nélkül kommunikálja.
