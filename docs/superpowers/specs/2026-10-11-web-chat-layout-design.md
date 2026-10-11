# Rögzített beviteli sáv és okos görgetés az apps/web chatben — design spec

- **Dátum:** 2026-10-11
- **Ág:** `feat/web-chat-layout` (a friss `main`-ről, a Markdown PR #28 után)
- **Hatókör:** csak `apps/web`. A `core`, a system prompt és a `customer-chat` nem változik.

## 1. Cél és sikerkritérium

Streamelés közben a Leállítás gomb „ugrál”, ezért alig lehet rányomni. Két oka van:

- **Függőleges:** a beviteli sáv a normál folyamban, az üzenetlista *után* áll. Ahogy a válasz nő, a sáv lefelé vándorol.
- **Vízszintes:** a `Küldés` és a `Leállítás` gomb szélessége eltér, ezért cseréjükkor az input is méretet vált.

Sikeres, ha a következők mind teljesülnek:

- a sáv a gombbal együtt az ablak alján ül, rövid és hosszú beszélgetésnél egyaránt, az üzenetek pedig fölötte görgetnek;
- a két gomb azonos méretű, a csere nem mozdít semmit;
- az automatikus görgetés csak akkor követi a streamelt szöveget, ha az olvasó alul van, és felgörgetésnél nem rántja vissza;
- felgörgetéskor egy „Ugrás az aljára” (`↓`) gomb jelenik meg, küldéskor pedig a nézet mindig az aljára ugrik;
- mobilon a billentyűzet nyitásakor is látható marad a sáv, az iOS nem nagyít rá az inputra, és az iPhone home indicatora nem takarja el a sávot;
- a görgetési döntések tiszta, unit-tesztelt függvényekben vannak.

## 2. Hatókörön kívül

- **A fejléc összecsukása mobilon:** a felhasználó nem kérte.
- **Többsoros beviteli mező** (`textarea`, Shift+Enter).
- **Sima (`smooth`) görgetés:** minden ugrás `instant`, mert a sima görgetés streamelés közben lemarad és rángat.
- **jsdom vagy Testing Library:** a jsdom nem számol layoutot (`scrollHeight` mindig 0), így a görgető hook tesztje csak a mockot mérné. A döntések a tiszta függvényekben teszteltek, a többit a kézi próba fedi.
- **Új függőség nincs.**

## 3. Megközelítés

A választott út: **az oldal görget, a sáv `position: sticky; bottom: 0`, és a fő oszlop legalább képernyőmagas, a sáv `margin-top: auto`-val**.

A `sticky` egymagában csak akkor tapad az ablak aljához, ha a tartalom már hosszabb a képernyőnél. Rövid beszélgetésnél, az első kérdés után a sáv az üzenetek alatt ülne, és a válasszal együtt mozogna. Ezért:

- a `main` legalább képernyőmagas (`min-height: 100dvh`), oszlopos flex elrendezéssel;
- a panel kitölti a maradék magasságot;
- a sáv `margin-top: auto`-val alulra kerül.

**Elvetett alternatívák:**

- **App-shell (`100dvh` magas oszlop, saját görgető lista):** iOS-en a `dvh` nem számol a billentyűzettel, így a sáv a billentyűzet mögé kerülhet. Ezt csak `visualViewport`-figyelő kóddal lehetne javítani. Mobilon a beágyazott görgetés gumiszalag-effektust ad, és a címsor sem csukódik össze.
- **`position: fixed` sáv:** az iOS-en a fixed elemek a billentyűzettel ismerten hibásak, és a lista helyfoglalását kézzel kellene a sáv magasságához igazítani.

## 4. Elrendezés

### 4.1 `apps/web/src/app/page.module.css`

**`.main`:**
- `min-height: 100vh; min-height: 100dvh;`, ahol a `vh` a régebbi böngészők fallbackje;
- `display: flex; flex-direction: column;`;
- az alsó padding 0, mert a sáv saját alsó paddinget kap;
- az oldalsó padding `max(16px, env(safe-area-inset-left/right))`, mert a `viewport-fit=cover` miatt fekvő iPhone-on a notch alá kerülhetne.

### 4.2 `apps/web/src/chat/chat-panel.tsx` és `chat.module.css`

- **`.panel`:** `flex: 1`, így a `main` maradék magasságát kitölti. Továbbra is oszlopos flex.
- **Új `<div className={styles.composer}>` a panel alján.** Tartalma sorrendben:
  1. a `↓` gomb, ha látszik (lásd 5.3);
  2. a hiba-`<p role="alert">`, ami a sávba kerül, így a form fölött mindig látszik;
  3. a `<form>`.
- **`.composer`:**
  - `position: sticky; bottom: 0; margin-top: auto;`
  - `display: flex; flex-direction: column; gap: 8px;`
  - `padding: 12px 0 max(12px, env(safe-area-inset-bottom));`
  - `background: var(--bg); border-top: 1px solid var(--border);`
- **`.button`:** `min-width: 7.5rem`. A `Küldés` és a `Leállítás` ugyanezt az osztályt kapja, így a csere nem változtat a szélességen.
- **`.input`:** `font-size: 16px`. A 16 px alatti input-betűméretnél az iOS fókuszkor ránagyítana.

### 4.3 `apps/web/src/app/layout.tsx`

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};
```

- **`interactiveWidget: 'resizes-content'`:** Android Chrome-on a billentyűzet összenyomja a layoutot, így a sáv látható marad. Az iOS Safari ezt figyelmen kívül hagyja, ott a böngésző a fókuszált inputot magától láthatóvá görgeti.
- **`viewportFit: 'cover'`:** enélkül az `env(safe-area-inset-*)` értéke 0.

## 5. Görgetéslogika

### 5.1 `apps/web/src/chat/scroll-follow.ts` (új, tiszta függvények, nincs React és DOM)

```ts
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface FollowState {
  isFollowing: boolean;
  lastScrollTop: number;
}

export const NEAR_BOTTOM_PX = 48;

/** True when the bottom of the view is within `threshold` px of the content's bottom. */
export function isNearBottom(metrics: ScrollMetrics, threshold?: number): boolean;

/** One scroll event: at the bottom → follow; scrolled up and not at the bottom → stop; otherwise keep. */
export function nextFollowState(prev: FollowState, metrics: ScrollMetrics): FollowState;

/** The ↓ button shows when the reader has left the bottom and there is something to return to. */
export function shouldShowJumpButton(isFollowing: boolean, messageCount: number): boolean;
```

**Szabályok:**

- `isNearBottom`:
  - `scrollHeight - clientHeight - scrollTop <= threshold`, ahol az alapértelmezett `threshold` a `NEAR_BOTTOM_PX` (48 px);
  - a képernyőnél rövidebb tartalom mindig „alul” van.
- `nextFollowState`:
  - ha a nézet alul van, a követés **mindig** igaz;
  - ha nincs alul, és a `scrollTop` csökkent (felfelé görgetés), a követés hamis;
  - különben az előző állapot marad;
  - a `lastScrollTop` mindig az új `scrollTop`.
  - **Miért:** csak a felhasználó felfelé görgetése kapcsolja ki a követést. A tartalom növekedése, például egy egyszerre érkező táblázat, soha nem csökkenti a `scrollTop`-ot, így egy közbeeső `scroll` esemény sem kapcsolja ki magától. Ha a tartalom zsugorodik (eltűnik a „Gondolkodom…” jelzés vagy egy hibaüzenet), a böngésző visszahúzhatja a nézetet, és a `scrollTop` csökken, de a nézet alul marad, így a követés megmarad.
- `shouldShowJumpButton`: `!isFollowing && messageCount > 0`.

### 5.2 `apps/web/src/chat/use-follow-bottom.ts` (új, kliensoldali hook)

`useFollowBottom(content: unknown): { isFollowing: boolean; scrollToBottom: () => void }`. Vékony réteg az 5.1 függvényei körül:

- **Állapot:** ref-ben tárolt `FollowState`, kezdetben `{ isFollowing: true, lastScrollTop: 0 }`, mellette egy `isFollowing` React-állapot a rendereléshez.
- **Görgetés:** passzív `scroll`-figyelő az ablakon. Minden eseménynél `nextFollowState(ref, readMetrics())`, ahol a `readMetrics` a `document.scrollingElement` méreteit olvassa.
- **Átméretezés:** `resize`-figyelő. Ha a követés be van kapcsolva, a nézet az aljára ugrik. Ez kezeli az Android billentyűzetét.
- **Új tartalom:** `useLayoutEffect` a `content`-re, ami a `messages` tömb, és minden streamelt darabnál új referencia. Ha a követés be van kapcsolva, a nézet az aljára ugrik. A `useLayoutEffect` miatt ez még a festés előtt történik, így nincs egy kockás villanás.
- **`scrollToBottom()`:** visszakapcsolja a követést, és a nézet az aljára ugrik.
- **Minden ugrás** `window.scrollTo({ top: scrollHeight, behavior: 'instant' })`.

### 5.3 Bekötés a `ChatPanel`-be

- **Hook:** `const { isFollowing, scrollToBottom } = useFollowBottom(messages);`
- **Küldés:** a `handleSubmit` a `sendMessage` előtt meghívja a `scrollToBottom()`-ot. Felgörgetett állapotban is az aljára ugrik, és követi az új választ.
- **A `↓` gomb:**
  - akkor renderelődik, ha `shouldShowJumpButton(isFollowing, messages.length)`;
  - `<button type="button" className={styles.jumpToBottom} aria-label="Ugrás az aljára" onClick={scrollToBottom}>↓</button>`;
  - a CSS-e `position: absolute; bottom: calc(100% + 8px); right: 0;`. Kerek, `var(--surface)` hátterű, `var(--border)` keretű gomb.
  - A sticky `.composer` a tartalmazó blokkja, így a gomb a sáv fölé lóg, nem foglal helyet, és **nem változtatja meg a sáv magasságát**.

## 6. Tesztelés

A meglévő módszer marad: node környezet, SSR (`renderToStaticMarkup`), és unit-tesztek a tiszta függvényekre. A CSS-viselkedést és a hook valódi görgetését az SSR nem látja, ezt a 6.3 kézi próba fedi.

### 6.1 `scroll-follow.spec.ts` (új)

**`isNearBottom`:**
- pontosan alul → igaz;
- a tűrésen belül (47 px) → igaz;
- a tűrés határán (48 px) → igaz;
- 1 px-szel a tűrésen túl (49 px) → hamis;
- a képernyőnél rövidebb tartalom → igaz;
- tört pixeles `scrollTop` alul → igaz;
- egyedi `threshold` → az érvényesül.

**`nextFollowState`:**
- követés közben a tartalom nő, a `scrollTop` nem változik, a nézet nincs alul → a követés megmarad;
- követés közben lefelé görgetés, de nem alulra → megmarad;
- felfelé görgetés a tűrésen túl → nem követ;
- felfelé görgetés a tűrésen belül → követ;
- **zsugorodó tartalom:** a `scrollTop` csökken, de a nézet alul marad (a „Gondolkodom…” jelzés vagy egy hibaüzenet eltűnése) → a követés megmarad;
- nem követ, lefelé görgetés, de nem alulra → továbbra sem követ;
- nem követ, visszagörgetés alulra → újra követ;
- a `lastScrollTop` mindig az új `scrollTop`.

**`shouldShowJumpButton`:**
- követ → hamis;
- nem követ, van üzenet → igaz;
- nem követ, nincs üzenet → hamis.

### 6.2 SSR-tesztek (bővülnek)

**`chat-panel.spec.tsx`:**
- az üzenetlista a `.composer` előtt van, a `.composer`-en belül pedig a hiba (`role="alert"`) a `<form>` előtt;
- a `Küldés` és (streamelés közben) a `Leállítás` gomb ugyanazt a `.button` osztályt kapja;
- az „Ugrás az aljára” gomb kezdetben, követés közben nem renderelődik.

**`layout.spec.ts` (új):** a `viewport` export `interactiveWidget: 'resizes-content'` és `viewportFit: 'cover'` értékű.

### 6.3 Kézi próba

Parancs: `pnpm nx dev web`, a :3001 porton. Desktop, DevTools 375 px széles nézet, sötét mód.

1. **Rövid beszélgetés:** az első kérdés után a sáv az ablak alján ül, és streamelés közben a Leállítás gomb **függőlegesen nem mozog**.
2. **Gombcsere:** Küldés ↔ Leállítás közben az input szélessége nem változik, a gomb **vízszintesen sem mozog**.
3. **Hosszú válasz:** az üzenetek a sáv mögött futnak el. Alul az utolsó sor nem bújik a sáv alá.
4. **Leállítás egy hosszú válasz közben:** elsőre eltalálható.
5. **Felgörgetés streamelés közben:** a nézetet nem rántja vissza, a `↓` gomb megjelenik, és **a sáv magassága nem változik** a megjelenésétől.
6. **A `↓` gomb megnyomása:** a nézet az aljára ugrik, a követés folytatódik, a gomb eltűnik.
7. **Kézi visszagörgetés az aljára:** a követés magától újraindul, a gomb eltűnik.
8. **Nagy tartalom egyszerre** (pl. táblázatos összehasonlítás) követés közben: **a követés nem szakad meg magától**.
9. **Felgörgetett állapotban új kérdés küldése:** a nézet az aljára ugrik, és követi az új választ.
10. **Hibaüzenet:** a sávban, a form fölött jelenik meg, és nem csúszik ki a képből.
11. **375 px:**
    - a sáv, a gombok és a `↓` gomb kényelmesen elférnek;
    - az inputra fókuszálva nincs automatikus nagyítás (iOS, ha van eszköz);
    - a billentyűzet nyitásakor a sáv látható marad (valós eszközön, ha van: Android Chrome vagy iOS Safari);
    - a DevTools a billentyűzetet nem emulálja, ezt a riport külön jelzi.
12. **Sötét mód:** a sáv háttere illeszkedik, a `↓` gomb olvasható.
13. **Markdown-regresszió:** a táblázat továbbra is görgethető a buborékon belül.

## 7. Commitok

1. `docs: add the web chat layout design spec and plan`
2. `feat(web): pin the composer to the bottom of the window`
   - `main` és `.panel` flex;
   - `.composer` (sticky, `margin-top: auto`), benne a hiba és a form;
   - a gombok `min-width`-je;
   - a `chat-panel` SSR-tesztek.
3. `feat(web): tune the chat for mobile`
   - a `viewport` export;
   - 16 px-es input;
   - safe area;
   - `layout.spec.ts`.
4. `feat(web): follow the streamed answer only while the reader is at the bottom`
   - `scroll-follow.ts` (`isNearBottom`, `nextFollowState`) és a specje;
   - `use-follow-bottom.ts`;
   - bekötés, küldéskor ugrás az aljára.
5. `feat(web): add a jump-to-bottom button`
   - `shouldShowJumpButton` és a tesztje;
   - a gomb és a CSS;
   - SSR-teszt: kezdetben nincs gomb.
6. `docs: describe the chat layout in CLAUDE.md`

**Ellenőrzés a végén:**
- `pnpm nx run-many -t lint,typecheck,test -p core web cli`;
- `pnpm nx build web` (csak az ismert, korábbi webpack-figyelmeztetés megengedett);
- független reviewer az egész ágra;
- kézi próba a 6.3 szerint.

A push, a PR-nyitás és a merge csak kifejezett jóváhagyás után történik.
