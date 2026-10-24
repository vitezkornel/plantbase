# Hang-mérések (kézi próba)

> A `/voice` oldal waterfall panelje alapján kitöltendő. Zöld < 800 ms, piros > 1500 ms. Az „első hang” a gomb felengedésétől az első hangig (a filler is számít) kliensoldalon mért idő; az STT, az első token és az összesen szerveroldali idő.

| Kérdés | STT-átirat | Modell (STT / TTS / hang) | STT ms | Első token ms | Első hang ms | Összesen ms | Filler BE/KI | Megjegyzés |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

## TTS-modellek megbízhatósága (2026-10-21)

Mérés a valódi OpenAI `/audio/speech` ellen, sima Node-ból (nyers `fetch`, Next és SDK nélkül), ugyanaz a rövid mondat („Megnézem a katalógusban.”), hang: `coral`, mp3, 8-8 egymás utáni hívás, 10 s időkorláttal. „Néma” = 10 s alatt sem érkezett válasz (még fejléc sem).

| Modell | Sikeres / 8 | Medián (sikeres) | Maximum (sikeres) | Megjegyzés |
|---|---|---|---|---|
| `tts-1` | 8/8 | 1584 ms | 3859 ms | megbízható; **alapérték** |
| `tts-1-hd` | 8/8 | 2417 ms | 5573 ms | megbízható, de lassabb, mint a 2 s-os cél |
| `gpt-4o-mini-tts-2025-03-20` | 8/8 | 959 ms | 1030 ms | a leggyorsabb és egyenletes |
| `gpt-4o-mini-tts` | 5/8 | 1409 ms | 1967 ms | a kérések ~fele néma |

Korábbi, azonos módszerű futások (nem a fenti táblából): `gpt-4o-mini-tts` 3/8 és 4/8 sikeres; `gpt-4o-mini-tts-2025-12-15` 0/8 (mind néma); `tts-1` 8/8 (1,0–1,8 s); `GET /v1/models` 8/8 gyors, a hálózat tehát rendben volt. Ugyanaz a kérés `curl`-lel is ~50%-ban néma maradt (8-ból 4 kérés 12 s-ig), IPv4-first DNS-sel és új kapcsolatonként is. A hiba tehát az OpenAI oldalán van, nem a Node-on, a Next-en vagy az SDK-n.

Következmények: az alapérték `tts-1`; a `gpt-4o-mini-tts` `VOICE_TTS_MODEL`-lel választható, és csak ahhoz tartozik hedging (2 s után egy párhuzamos kérés, az nyer, amelyik előbb végez); minden modellnél védőháló az 5 s-os néma-újrapróbálás (legfeljebb 3 kísérlet). A régi `gpt-4o-mini-tts-2025-03-20` snapshot ezen a napon a legjobb volt; a snapshotok idővel kivezetődhetnek, ezért nem az alapérték.

## Kézi próba: `tts-1` (2026-10-21, bemelegítés után)

| Kérdés | STT-átirat | Modell (STT / TTS / hang) | STT ms | Első token ms | Első hang ms | Összesen ms | Filler BE/KI | Megjegyzés |
|---|---|---|---|---|---|---|---|---|
| Milyen kaktuszaitok vannak? | jó | gpt-transcribe / tts-1 / coral | 696 | 3141 | 5068 | 8587 | KI | hiba nélkül, mind a 4 sáv kitöltődött; a filler nem szólt (lásd lent) |
| Melyik növény bírja az árnyékot és macskabarát? | jó | gpt-transcribe / tts-1 / coral | – | – | – | – | KI | a válasz rendben; a filler nem szólt |

A latin nevek, a követő kérdés, a barge-in, az eszkaláció és a szöveges chat rendben volt.

**Filler hiba (javítva).** A bemelegítés sikerült (mind az 5 filler kész), a `tool` esemény is megjött, de a `filler` esemény nem. Ok: a Next dev route-onként külön csomagol, ezért a `filler-cache` modulszintű `Map`-je két példány volt: a `/api/voice/warmup` töltötte, a `/api/voice` üres példányt olvasott. A cache most a `globalThis`-on él. Ellenőrzés a futó dev szerveren, valódi `/api/voice` fordulóval: a `filler` esemény a `tool` eseménnyel egy időben érkezik, a javítás előtt nem érkezett. A szerveroldali első token itt 3,1–3,9 s volt (a `runSql`-os kérdéseknél a két LLM-lépés miatt), ezt a filler hivatott áthidalni.

## Hallgatási próba: magyar kiejtés (2026-10-21)

Kézi, füllel végzett összevetés a `/voice` oldalon, ugyanazokkal a kérdésekkel, `coral` hanggal.

| TTS-modell | Felhasználói értékelés | Megbízhatóság (lásd fent) |
|---|---|---|
| `tts-1` | elfogadható, de a magyar kiejtése gyengébb | 8/8, medián 1584 ms |
| `gpt-4o-mini-tts-2025-03-20` | **sokkal jobb magyar kiejtés** | 8/8, medián 959 ms |

Döntés: az alapérték a `gpt-4o-mini-tts-2025-03-20`; a snapshot kivezetésre jelölt, ezért ha az API a modellt nem elérhetőnek jelzi, az adott mondatot automatikusan `tts-1`-gyel generáljuk újra (`api_voice.tts_fallback {from, to}`).

**Filler a javítás után.** A filler a `filler-cache` javítása (a cache a `globalThis`-on él) után szól: kézi próbán `runSql` és `searchKnowledge` kérdésnél is hallható volt, a tool-hívás pillanatában, a válasz előtt.

## 2. szakasz: `/voice/live` (hibrid realtime + supervisor, 2026-10-24)

Kézi próba, `gpt-realtime-2.1`, fülhallgatóval. Részletes ellenőrzőlista: [`docs/voice-live-kezi-ellenorzes.md`](voice-live-kezi-ellenorzes.md).

| Mutató | Érték | Megjegyzés |
|---|---|---|
| Csend a beszéd végétől az első hangig | ~0,3–0,5 s | a realtime modell filler vagy válasz hangja |
| Supervisor (`supervisor_done`) a javítások előtt | 9,3–17,5 s | thinking alapból be, nincs prompt caching |
| Supervisor a javítások után | ~5,6–6,1 s | thinking kikapcsolva (`VOICE_THINKING=off`) + prompt caching |
| Első hívás extra ideje | ~7–10 s | **csak dev**: az első kérésnél a `/api/voice/supervisor` route fordítása és a core betöltése; a második/harmadik hívásnál a „többi” (hálózat, route-indulás) 0,1 s |

- A tool-hívástól a válaszig mért idő a szerver ideje (`serverMs`) és a „többi” összege; a kettő különbsége az eseménylogban látszik.
- A thinking-kikapcsolás és a prompt caching előtti és utáni értékek ugyanazzal a kérdéstípussal (kaktusz-katalógus) készültek, de nem kontrollált mérésben.
