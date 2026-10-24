# /voice/live — kézi ellenőrzés (nem CI)

Előfeltétel: `OPENAI_API_KEY` a `.env`-ben, `pnpm nx dev web`, fülhallgató, Chrome. Dátum / modell: 2026-10-24 / `gpt-realtime-2.1` (server VAD és semantic VAD).

## Megerősítendő API-tények
- [x] `gpt-realtime-2.1` elérhető: a szerverlogban `session_created … model: gpt-realtime-2.1`, nincs `session_fallback`
- [x] `reasoning.effort: low` elfogadva (nincs `session_failed`)
- [ ] `calls?model=` szükséges-e ephemeral kulccsal — nem külön ellenőrizve (a kapcsolat a `?model=` paraméterrel működik)
- [ ] az első ügynök-hang eseménye (`output_audio_buffer.started` vagy a `…transcript.delta`) — nem külön ellenőrizve; a csendmérés mindkét esetben értéket adott
- [ ] seedelt assistant `output_text` item nem rontja a hangos választ újrakapcsolás után — nem külön ellenőrizve
- [x] **I2:** a `conversation_already_has_active_response` versenyhelyzet élőben előjött: a nudge `response.create`-je (5,0 s) és a supervisor-válasz `response.create`-je (5,2 s) között a `response.created` még nem érkezett meg, az API elutasította a válaszét, és a válasz elveszett (lefagyásnak tűnt). Javítva: a „foglalt” állapot a `response.create` elküldésekor áll be, az API-elutasítás után a válasz újra sorba kerül (`response.done`-ra, vagy 400 ms múlva). Újrafuttatva a „tartva” sor jelent meg („eredmény tartva, a modell még beszél”), a válasz elhangzott.

## Mérés (összegzés — nem a 4 soros mátrix)
| Mutató | Érték |
|---|---|
| Csend a beszéd végétől az első hangig | ~0,3–0,5 s |
| Supervisor (szerver, `supervisor_done`) | ~5,6–6,1 s (thinking kikapcsolva + prompt caching után); előtte 9,3–17,5 s |
| Első hívás extra ideje | dev route-fordítás, kb. 7–10 s; a második/harmadik hívásnál a „többi” 0,1 s |

Filler BE/KI összevetése: viselkedésben ok; a 4 soros mátrix számai nincsenek rögzítve.

## Viselkedés
- [x] 5 s-os „Még keresem” frissítés egyszer szól (filler BE, lassú kérdés)
- [x] közbevágás a supervisor-várakozás alatt: az eseménylogban „elavult”, a régi válasz nem hangzik el
- [x] közbevágás hosszú válasz közben: ok
- [x] semantic VAD hezitálással („A rendelésszámom… őőő… várj”): ok
- [x] valódi rendelési kérdés (`VOICE_DEMO_ORDERS` nélkül): „Kollégának továbbítva”
- [ ] `VOICE_DEMO_ORDERS=1`: „DEMO” címke, ~6 s késleltetés — nem próbáltuk (opcionális)
- [x] forrás- és ár-kimondás: katalógus-válasz forráscikk nélkül is elhangzik (35. sor), ár/terméknév szó szerint
- [x] követő kérdések (kaktusz → macskabarát → öntözés): mind jó; a supervisor fő kérdése a pontos átirat volt, a modell a saját félreértése ellenére hűen kimondta a választ
- [x] átirat-minőség: a gpt-transcribe átirat 5/5 pontos volt, a modell saját kérdés-megfogalmazása 0/5 (lásd a spec 8. pontját)
- [x] bontás / oldal elhagyása → a mikrofon-jelző kialszik
- [x] szöveges chat (`/`) a prompt caching után: ok
- [ ] VAD/filler váltás újrakapcsolódás és az 5 perces tétlenségi bontás — külön nem rögzítve
- [ ] fantomkérdés (köhögés/zaj): a javítások után a követő-kérdéses próbán nem jött elő; külön, ismételt köhögéses teszt nincs rögzítve
