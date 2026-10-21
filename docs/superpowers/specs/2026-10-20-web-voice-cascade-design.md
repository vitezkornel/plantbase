# Hang-funkció 1. szakasz: cascade (STT → ask-agent → TTS) az apps/web-ben — design spec

- **Dátum:** 2026-10-20
- **Ág:** `feat/web-voice-cascade` (a friss `main`-ről, PR #29 után)
- **Hatókör:** új `/voice` oldal és két új route az `apps/web`-ben; a `packages/core`-ban egyetlen nem törő opció és egy prompt-konstans. Az ask-agent négy toolja, a szöveges chat és a megosztott system prompt nem változik.

## 1. Cél és sikerkritérium

Nyomva tartott gombbal (vagy a szóközzel) magyarul beszélek; a rendszer átírja (STT), a **meglévő** ask-agent válaszol, a választ mondatonként felolvassa (TTS). Egy waterfall panel mutatja az időket és a köztes szövegeket.

Sikeres, ha:

- a gomb nyomva tartása alatt felvétel megy, felengedésre elindul a kör; a szóköz ugyanezt teszi;
- a felolvasás az első kész mondatnál indul, nem a teljes válasz végén;
- a gomb újbóli megnyomása azonnal leállítja a felolvasást és a streamet (kézi barge-in), és új felvételt indít;
- tool-hívásnál rövid, előre elkészített kitöltő mondat szól, 5 s után frissítéssel; ha a filler nincs kész, kimarad;
- a waterfall panel mutatja: STT ms, első token ms, első hang ms, összesen (zöld < 800 ms, piros > 1500 ms, köztes sárga), valamint az átiratot, a streamelt szöveget és a tool-lépéseket;
- az OpenAI-kulcs csak szerveren él; hangot nem tárolunk; átirat csak a JSONL interakció-naplóba kerül;
- a tesztekben nincs valódi OpenAI-hívás.

## 2. Megerősített döntések

| Téma | Döntés |
|---|---|
| Beszélgetés | Többfordulós: a kliens a szöveges átiratokat és válaszokat memóriában tartja, és előzményként elküldi. |
| STT | `gpt-transcribe`, tartalék `gpt-4o-transcribe`; felülírható: `VOICE_STT_MODEL`. |
| TTS | `tts-1`, hang alapértéke `coral`; felülírható: `VOICE_TTS_MODEL` (a `gpt-4o-mini-tts` választható, hedginggel), `VOICE_TTS_VOICE`. Az indok a 4. fejezet 7. pontjában. |
| Provider | Vercel AI SDK: `experimental_transcribe`, `experimental_generateSpeech`; a provider egy sorral cserélhető. |
| Szállítás | Egy `POST /api/voice`, NDJSON-folyam válasszal. |
| Filler | Memória-cache, oldalbetöltéskor előmelegítve, kulcsa `modell\|hang\|szöveg`; nem kész filler kimarad. |

## 3. Hatókörön kívül

- Autentikáció és rate limit (a `/api/chat`-nak sincs). **Ismert kockázat:** a `/voice` költséges külső hívást indít, ezért nyilvános környezetbe kitenni védelem nélkül nem szabad. A fordulónkénti költségplafon (6.3) csak egy fordulót korlátoz.
- Streaming STT, Realtime API, hangaktivitás-érzékelés (VAD): ez a 2. szakasz kérdése.
- Hangfelvétel vagy átirat tárolása az interakció-naplón túl.
- Új toolok, az ask-agent promptjának módosítása.
- Natív mobilalkalmazás; jsdom és Testing Library (a repó módszere: node-környezet, SSR + tiszta függvények).

## 4. Verifikált tények és kockázatok

Forrás: a telepített csomagok kódja, context7, `developers.openai.com`. Nem emlékezetből.

1. **A rögzített `ai@5.0.261` exportálja** az `experimental_transcribe`-ot és az `experimental_generateSpeech`-et; az `ai/test` pedig a `MockTranscriptionModelV2`-t és `MockSpeechModelV2`-t.
2. **Új függőség: `@ai-sdk/openai@2.0.135`** (az `ai-v5` dist-tag), pontos verzióval az `apps/web/package.json`-ban. Peer függősége csak a `zod`, így nem hoz második `ai`-példányt.
3. **`gpt-transcribe` és a 2.0.135 provider.**
   - A modellnév típus-szinten átmegy (`string & {}`).
   - A provider a `response_format`-ot minden nem-`gpt-4o*` modellre `verbose_json`-ra állítja; a doksi a `verbose_json`-t csak `whisper-1`-nél említi.
   - A `providerOptions.openai` sémája csak `include`, `language`, `prompt`, `temperature`, `timestampGranularities` mezőket ismeri. A `gpt-transcribe` `keywords[]` és `languages[]` mezői nincsenek benne, és a `language` a `languages`-szel együtt nem küldhető.
   - **Megoldás:** a `createOpenAI({ fetch })` fetch-wrappere a `/audio/transcriptions` multipart törzsét szerkeszti: törli a `response_format`-ot, hozzáadja a `languages[]=hu` és a `keywords[]` mezőket (növénynevek). A hívás továbbra is `transcribe()`.
   - **Döntési pont:** az élő smoke próba (7.3) dönt. Ha az API a wrapperes kérést elutasítja, az alapérték `gpt-4o-transcribe` (SDK-natív, `json`, a kontextus `prompt`-ban).
4. **Hangformátumok.** `gpt-transcribe`: mp3, mp4, mpeg, mpga, m4a, wav, webm; legfeljebb 25 MB; **ogg nincs a listán**. A kliens `MediaRecorder.isTypeSupported` sorrendje: `audio/webm;codecs=opus`, majd `audio/mp4`. Ha egyik sem támogatott, a gomb tiltott, és magyar üzenet jelzi.
5. **Az `streamAskAgent` rendszerpromptja fix**, ezért a `<voice>` szekcióhoz a core-ba egy nem törő opció kell (5.1).
6. A gyökér `.env.example`-ben nincs OpenAI-sor.
7. **Ismert kockázat: `gpt-4o-mini-tts` ~50% néma kérés (2026-10-21).** A modell a kérések nagyjából felét elfogadja, majd nem válaszol (sima Node-ból és `curl`-lel is reprodukálható; `tts-1` és a `gpt-4o-mini-tts-2025-03-20` snapshot nem érintett). Mérések: [`docs/voice-meresek.md`](../../voice-meresek.md). Kezelés: alapérték `tts-1`; a `gpt-4o-mini-tts`-hez hedging (2 s után egy párhuzamos kérés, az nyer, amelyik előbb végez); minden modellnél 5 s-os néma-újrapróbálás (legfeljebb 3 kísérlet); egy elbukott mondat kimarad (`speech-failed`), a forduló nem.

## 5. Architektúra

### 5.1 Core: `mode` opció és `VOICE_PROMPT_SECTION`

- `StreamAskAgentOptions.mode?: 'text' | 'voice'`, alapérték `'text'`. **Nem szabad szöveg:** a hívó nem tud tetszőleges promptot beinjektálni.
- Új fájl: `packages/core/src/agents/ask-agent/voice-prompt.ts`, benne a `VOICE_PROMPT_SECTION` konstans (7.1).
- A `streamAskAgent` a rendszerprompt-et a módból számolja: `text` → `ASK_AGENT_SYSTEM_PROMPT` **bájtra azonosan**; `voice` → `ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION`.
- A JSONL-log `system` mezője a **tényleges** promptot rögzíti (a `buildLogEntry` ugyanazt az értéket kapja, mint a `streamText`).
- `core/src/index.ts`: exportálja a `VOICE_PROMPT_SECTION`-t és a toolnevek konstansait (`RUN_SQL_TOOL_NAME`, `SEARCH_KNOWLEDGE_TOOL_NAME`, `LIST_CATEGORIES_TOOL_NAME`, `CUSTOMER_PREFERENCES_TOOL_NAME`), amelyek ma csak belsők.
- **`docs/system-prompt.md`:** a `<voice>` szöveg **nem** kerül bele. Az XML-blokkon *kívül* egy rövid megjegyzés áll: voice módban a prompthoz a `voice-prompt.ts` `VOICE_PROMPT_SECTION` konstansa fűződik. A `.ts` mirror az XML szó szerinti mása, ezért a mirror nem változik; ezt a commit előtt ellenőrizzük.

### 5.2 `POST /api/voice` (`apps/web/src/app/api/voice/route.ts`)

`runtime = 'nodejs'`, `import 'server-only'`. Kérés: `multipart/form-data`, mezői pontosan `audio` (Blob) és `history` (JSON-szöveg). Ismeretlen mező → 400.

Válasz: `application/x-ndjson`, soronként egy JSON-esemény. A hang base64-kódolt mp3.

| Esemény | Mezők |
|---|---|
| `transcript` | `text`, `sttMs` |
| `tool` | `name` |
| `filler` | `text`, `audio` |
| `text-delta` | `text` |
| `sentence` | `index`, `text`, `audio`, `ttsMs` |
| `escalated` | (nincs; csak ha a válasz `[ESCALATE] `-tel kezdődik) |
| `timing` | `sttMs`, `firstTokenMs`, `firstSentenceMs`, `totalMs` |
| `done` | (nincs) |
| `error` | `message` (általános magyar üzenet) |

Egyetlen fetch van, így a barge-in egyetlen `AbortController`. A `request.signal` megy a core `abortSignal`-jába és minden külső hívásba (`AbortSignal.any([request.signal, AbortSignal.timeout(ms)])`).

**Folyamat:**

1. Validáció (5.3), kulcsellenőrzés (6.3).
2. STT (`transcribeAudio`) → `transcript` esemény.
3. `streamAskAgent([...history, {role:'user', content: text}], { mode: 'voice', abortSignal })`.
4. A `result.fullStream` feldolgozása (`tool-call`, `text-delta`, `finish`):
   - `tool-call` → `tool` esemény + filler (5.5);
   - `text-delta` → `text-delta` esemény + a mondatbontóba;
   - kész mondat → TTS (max 2 párhuzamos), **sorrendtartó** kibocsátás → `sentence`.
5. `timing`, `done`.

### 5.3 Kérés-séma és korlátok (`voice-request-schema.ts`, `transcribe-audio.ts`)

- `strictObject`: ismeretlen mező → 400.
- `history`: legfeljebb 20 üzenet, csak `user`/`assistant` szöveg, `system` és `tool` nem engedett; üzenetenként legfeljebb 2000 karakter. A core a `StreamAskAgentInputSchema`-val újra validál.
- `audio`: legfeljebb **2 MB**; MIME-allowlist (a `;codecs=` lecsupaszítva): `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/m4a`. Egyéb → 400.
- Felvétel legfeljebb **30 s**: a kliens automatikusan leállít; a szerver a `durationInSeconds`-t, ha az átirat visszaadja, utólag ellenőrzi (> 31 s → 400).
- Időkorlátok: STT 15 s, TTS mondatonként 15 s.
- Az üres vagy csak szóközöket tartalmazó átirat → `error` esemény („Nem hallottam semmit, próbáld újra.”), LLM-hívás nélkül.

### 5.4 Mondatbontó és TTS (`sentence-splitter.ts`, `speak-sentences.ts`)

`sentence-splitter.ts` tiszta függvény: streamelt szövegdarabokból kész mondatokat ad.

- Mondathatár: `.`, `!`, `?` után szóköz vagy sorvég.
- Nem határ: magyar rövidítések (`pl.`, `kb.`, `stb.`, `db.`, `ún.`, `ill.`), tizedesvessző (`1,5 m`), ezres tagolás (`2 490 Ft`), számozás (`1.`).
- A `[ESCALATE] ` előtag lekerül a felolvasandó szövegről (a `core` `ESCALATE_PREFIX` konstansával), és az `escalated` esemény jelzi.
- Védőháló a prompt mellett: a markdown-jelek (`*`, `_`, `#`, `` ` ``, `[](...)`, listajelek) a TTS elől eltűnnek.
- A felolvasott szöveg összhossza legfeljebb `MAX_SPOKEN_CHARS = 1200`. A határt elérve a felolvasás a következő mondathatárnál véget ér, és egy zárómondat szól: „A többit leírva láthatod.” A képernyőn a szöveg teljes marad.

`speak-sentences.ts`: mondatonként `generateSpeech({ model, text, voice, outputFormat: 'mp3', abortSignal })`, max 2 párhuzamos hívás, a kibocsátás sorrendje a mondatok sorrendje.

### 5.5 Filler (`filler-cache.ts`)

- Tárolás: `Map<string, Promise<Uint8Array>>`, kulcs: `` `${ttsModel}|${voice}|${text}` ``. Modell- vagy hangváltáskor új kulcs jön létre, a régi hang nem szólhat.
- `warmFillers()`: háttérben legenerálja az összeset; a hiba nem dob (a filler opcionális), csak üzemi logba megy (esemény, nincs szöveg). A `POST /api/voice/warmup` hívja, a `/voice` oldal betöltésekor.
- `getFillerIfReady(text)`: **sosem vár**. Ha a Promise még nem teljesült, `undefined`, és a filler kimarad.
- Szövegek toolonként:

| Tool | Filler |
|---|---|
| `runSql` | „Megnézem a katalógusban…” |
| `searchKnowledge` | „Utánanézek a gondozási tudástárban…” |
| `listCategories` | „Megnézem, milyen kategóriáink vannak…” |
| `customerPreferences` | „Egy pillanat…” (semleges: a tool nem csak olvas) |
| ismeretlen tool | nincs filler |

- **Frissítés:** ha a tool-hívás óta 5 s eltelt, és még nem érkezett `text-delta`, egy második filler szól: „Még keresem, mindjárt mondom.” (szintén előmelegített).
- Egy fordulóban legfeljebb egy tool-filler és egy frissítés szól. Ha már elindult mondat-hang, a filler eldobódik (a kliensen is, 5.7).

### 5.6 Szerveroldali időmérés

`t0` = a kérés megérkezése (`performance.now()`).

- `sttMs`: az STT hívás hossza.
- `firstTokenMs`: `t0`-tól az első `text-delta`-ig.
- `firstSentenceMs`: `t0`-tól az első `sentence` kibocsátásáig.
- `totalMs`: `t0`-tól a `done`-ig.

### 5.7 Kliens (`apps/web/src/voice/`, `app/voice/page.tsx`)

- **`use-push-to-talk.ts`:** pointer-down/up a gombon, plusz szóköz. A `keydown` `repeat`-jét kiszűri; ha a fókusz `input`/`textarea`/`button`-on van, a szóköz nem aktív. `MediaRecorder`, 30 s-nál automatikus leállítás, mikrofon-engedély hibája magyar üzenettel.
- **`ndjson-parser.ts` és `voice-state.ts`:** tiszta függvény és reducer. A reducer fordulónként tárolja az átiratot, a szöveget, a tool-lépéseket, az időket és az `escalated` jelzőt.
- **`audio-queue.ts`:** sorban játszik le; `stop()` azonnal megállít és kiürít. Lejátszás indulásakor jelzi az időpontot (az „első hang” méréséhez). A filler eldobódik, ha már szólt vagy sorban áll mondat-hang.
- **Barge-in:** a gomb megnyomása, ha épp felolvasás vagy stream megy: `AbortController.abort()` (→ `request.signal`), `audio-queue.stop()`, majd új felvétel.
- **Első hang (kliens):** a gomb felengedésétől az első lejátszás elindulásáig mért idő (benne a feltöltés és a hálózat). A szerver STT / első token / összes idejét a `timing` esemény hozza.
- **`waterfall-panel.tsx`:** négy sáv (STT, első token, első hang, összesen), a színt a `timing-thresholds.ts` tiszta függvénye adja (`< 800` zöld, `> 1500` piros, különben sárga). Alatta az átirat, a streamelt szöveg és a tool-lépések. Az eszkaláció jelzése ugyanaz, mint a chatben (az `apps/web/src/chat/escalation.ts` újrahasznosítása).
- **Oldal:** betöltéskor `POST /api/voice/warmup`; link a chatről és vissza.
- **Előzmény:** a befejezett fordulók szöveges átirata és válasza (a válasz szövege úgy, ahogy a modell adta, `[ESCALATE] ` előtaggal együtt, hogy a modell a saját korábbi mondatát hűen lássa). Megszakított forduló részleges válasza nem kerül az előzménybe.

## 6. Napló, titkok, költség

### 6.1 Napló

- **Hangot nem tárolunk:** a felvétel memóriában marad, fájlba nem írjuk.
- **Átirat csak a JSONL interakció-naplóba kerül**, a core user-üzenetként rögzíti.
- **Üzemi logger** (`logger`): csak esemény és ms: `api_voice.stt_done {sttMs}`, `api_voice.first_token {firstTokenMs}`, `api_voice.first_sentence {firstSentenceMs}`, `api_voice.completed {totalMs}`, `api_voice.aborted`, `api_voice.failed`, `api_voice.filler_warm_failed`. A felhasználó szövege soha nem kerül bele.
- **Hibák:** az AI SDK `APICallError` a kérés törzsét (a TTS-nél a mondat szövegét) is hordozza, ezért az üzemi logba csak a szanitált hiba megy (név, státuszkód), a `withoutInputValue` mintájára.

### 6.2 Titkok

- `OPENAI_API_KEY` csak szerveroldalon; semmi nem `NEXT_PUBLIC_`.
- `.env.example`: üres `OPENAI_API_KEY=` sor, valamint kikommentelt `VOICE_STT_MODEL`, `VOICE_TTS_MODEL`, `VOICE_TTS_VOICE`. A gyökér `.env`-hez nem nyúlunk.

### 6.3 Költségplafon és hiányzó kulcs

- Fordulónként a felolvasott szöveg legfeljebb 1200 karakter (5.4).
- Ha az `OPENAI_API_KEY` nincs beállítva, a `/api/voice` és a warmup érthető magyar hibát ad (503, „A hangfunkció nincs beállítva (hiányzik az OPENAI_API_KEY).”), nem stack trace-t. A hiányt az üzemi log eseményként jelzi (`api_voice.not_configured`).

## 7. A `<voice>` prompt és a tesztelés

### 7.1 `VOICE_PROMPT_SECTION` (szó szerint)

```xml

<voice>
A válaszod fel lesz olvasva, nem olvasni fogják: úgy fogalmazz, ahogy egy barátságos, szakértő növényes eladó mondaná élőszóban.
- Rövid, egyszerű mondatok; összesen legfeljebb 3-4 mondat, kivéve ha a felhasználó kifejezetten részletet kér.
- Egyszerre legfeljebb egy kérdést tegyél fel.
- Nincs markdown, felsorolásjel, táblázat, kód, emoji és link. Több találatnál legfeljebb három nevet mondj egy mondatban; ha ennél több van, mondd ki, hány találat van, és kérdezz rá egy szűkítő szempontra (például fény, méret, ár vagy háziállat).
- Számokat és árakat kimondható alakban írj: "forint", nem "Ft"; "centiméter", nem "cm"; "körülbelül", nem "kb.". Az árat pontosan mondd, ne kerekítsd.
- A latin nevet csak akkor mondd, ha kérik.
- Forrásnál ne URL-t mondj: természetesen utalj rá ("a gondozási tudástár szerint").
- A kérdés gépi átirat, lehet benne félrehallás. Ha egy szó vagy növénynév furcsa, vagy a kérés nem egyértelmű, ne találgass: röviden kérdezz vissza ("Jól értem, hogy ... ?").
- Ez a szakasz csak a megfogalmazás módját írja felül. Az SQL-, adat-, biztonsági és eszkalációs szabályok változatlanok: ha át kell adni a kérdést, a válasz továbbra is az [ESCALATE] előtaggal kezdődik.
</voice>
```

### 7.2 Automata tesztek (valódi OpenAI-hívás nincs)

**Core:**
- `text` módban (és `mode` nélkül) a `streamText`-nek átadott `system` **bájtra azonos** az `ASK_AGENT_SYSTEM_PROMPT`-tal.
- `voice` módban pontosan `ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION`.
- A JSONL-log `system` mezője mindkét módban a tényleges prompt.
- A meglévő ask-agent és ask-agent-stream toolkészlet-teszt (csak a négy tool) változatlanul zöld.

**Web, tiszta függvények:** `sentence-splitter` (rövidítések, tizedes, ezres, `[ESCALATE]`, markdown, 1200 karakteres határ), `timing-thresholds` (799/800/1500/1501 ms), `ndjson-parser` (darabolt sorok), `voice-state`, `voice-request-schema` (ismeretlen mező, `system`/`tool` szerep, túl hosszú előzmény), `filler-cache` (kulcs modellre és hangra, előmelegítés, „nincs kész → kimarad”, az 5 s-os frissítés fake timerrel).

**Web, route-integráció** (`MockTranscriptionModelV2`, `MockSpeechModelV2`, `MockLanguageModelV2`, injektált providerekkel):
- eseménysorrend: `transcript` → `text-delta`-k → `sentence`-ek → `timing` → `done`;
- a `sentence` események sorrendje a mondatok sorrendje akkor is, ha a második TTS hamarabb végez;
- a barge-in: az `abort` leállítja a streamet és a TTS-t;
- tévesztő MIME, 2 MB feletti hang, ismeretlen mező → 400;
- hiányzó kulcs → 503 magyar hibával;
- az üzemi log hívásainak mezői között nincs átirat- vagy mondatszöveg;
- a chat route meglévő tesztjei változatlanul zöldek.

**Fetch-wrapper:** a `/audio/transcriptions` multipartból törli a `response_format`-ot, hozzáadja a `languages[]=hu` és a `keywords[]` mezőket; más URL-t érintetlenül hagy.

### 7.3 Kézi próba (élő API-val)

Parancs: `pnpm nx dev web`, majd `http://localhost:3001/voice`. Kell hozzá az `OPENAI_API_KEY` a gyökér `.env`-ben.

1. **STT smoke:** egy rövid magyar mondat `gpt-transcribe` + fetch-wrapperrel. Ha az API elutasítja, `VOICE_STT_MODEL=gpt-4o-transcribe`, és az alapérték változik.
2. **Mérés:** minden kérdésnél kitöltjük a `docs/voice-meresek.md` sablont (kérdés, STT-átirat, modell, STT ms, első token ms, első hang ms, összesen, filler BE/KI, megjegyzés). Összevetés: `gpt-transcribe` és `gpt-4o-mini-transcribe`.
3. **Hangok:** 2–3 TTS-hang összehasonlítása a magyar kiejtés miatt (`coral` az alapérték).
4. Egy `runSql`-os és egy `searchKnowledge`-es kérdés: szól-e a filler, és az 5 s-os frissítés (lassított hálózattal).
5. **Barge-in:** felolvasás közben gombnyomás → azonnal elnémul, új felvétel indul. Szóközzel is.
6. **30 s-os limit:** a felvétel magától leáll.
7. Többfordulós követő kérdés („és az pet-safe?”).
8. Eszkalációs kérdés („hol a rendelésem?”): a jelzés megjelenik, az `[ESCALATE]` nem hangzik el.
9. Chrome és Safari formátum (webm / mp4); sötét mód; 375 px.
10. A szöveges chat (`/`) változatlanul működik.

## 8. Commitok

1. `docs: add the web voice cascade design spec and plan`
2. `feat(core): add the voice mode to the streaming ask-agent`: `mode`, `VOICE_PROMPT_SECTION`, exportok, tesztek, a `docs/system-prompt.md` rövid hivatkozása.
3. `feat(web): add the voice pure helpers`: mondatbontó, időküszöbök, kérés-séma.
4. `feat(web): add the speech providers and the filler cache`.
5. `feat(web): add the /api/voice and warmup routes`.
6. `feat(web): add the voice page`: rögzítés, hangsor, waterfall, oldal.
7. `docs: document the voice mode`: `CLAUDE.md`, `architektura.md`, `.env.example`, `README.md` (`/voice`, `OPENAI_API_KEY`, `VOICE_*`), `docs/voice-meresek.md` sablon.

**Eljárás:** csak explicit útvonalú `git add`; a `.env` és a követetlen `docs/projekt-statusz.md` érintetlen. Záráskor `pnpm nx run-many -t lint,typecheck,test`, `pnpm nx build web`, független reviewer. A push, a PR és a merge csak kifejezett jóváhagyással történik.
