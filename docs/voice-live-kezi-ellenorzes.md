# /voice/live — kézi ellenőrzés (nem CI)

Előfeltétel: `OPENAI_API_KEY` a `.env`-ben, `pnpm nx dev web`, fülhallgató, Chrome. Dátum / modell: ______

## Megerősítendő API-tények
- [ ] `gpt-realtime-2.1` elérhető (különben a szerverlogban `api_voice_live.session_fallback`, a UI-n `gpt-realtime`)
- [ ] `reasoning.effort: low` elfogadva (nincs `session_failed`)
- [ ] `calls?model=` szükséges-e ephemeral kulccsal (próbáld a `?model=` nélkül is)
- [ ] az első ügynök-hang eseménye: `output_audio_buffer.started` vagy csak a `…transcript.delta`
- [ ] seedelt assistant `output_text` item nem rontja a hangos választ újrakapcsolás után
- [ ] **I2:** `response.create` futó válasz alatt — a kliens ilyenkor tartja és `response.done`-ra küldi. Ellenőrizd élőben: (1) filler BE, lassú kérdés: a filler még szól, amikor a supervisor-válasz megérkezik — a végső válasz elhangzik-e, és nincs-e `conversation_already_has_active_response` hiba az eseménylogban; (2) ha a hold nélkül is működne az API, jegyezd fel (a hold ilyenkor csak felesleges késleltetés); (3) közbevágás a tartott válasz alatt: a tartott `response.create` eldobódik, a régi válasz nem szól

## Mérés (3 ismétlés / sor, másodperc)
| Eset | Csend a beszéd végétől (a) | Csend a tool-hívástól (b) |
|---|---|---|
| filler BE, server_vad | | |
| filler KI, server_vad | | |
| filler BE, semantic_vad | | |
| filler KI, semantic_vad | | |
A KI/BE különbség a (b) oszlopban látszik.

## Viselkedés
- [ ] 5 s-os „Még keresem” frissítés pontosan egyszer szól (filler BE, lassú kérdés)
- [ ] közbevágás a supervisor-várakozás alatt: eseménylogban „elavult”, a régi válasz nem hangzik el
- [ ] valódi rendelési kérdés (VOICE_DEMO_ORDERS nélkül): „Kollégának továbbítva”
- [ ] VOICE_DEMO_ORDERS=1: „DEMO” címke, ~6 s késleltetés, a modell jelzi, hogy demó adat
- [ ] forrás címe kimondva, URL nem; ár/terméknév szó szerint
- [ ] VAD/filler váltás újrakapcsolódik, az előzmény megmarad (a seed a data channel megnyitásáig pufferelve van)
- [ ] 5 perc tétlenség után automatikus bontás; oldal elhagyásakor a mikrofon-jelző kialszik
- [ ] átirat-minőség: a „közelítő átirat” a JSONL `clientTranscript`-ben vs. a modell megfogalmazása (`messages`)
- [ ] fantomkérdés: köhögés / nevetés / háttérzaj közben nincs askPlantbase-hívás (az eseménylogban nincs „Tool-hívás”), a modell legfeljebb röviden visszakérdez; ismételd server_vad és semantic_vad mellett is
- [ ] javító mondat („de én növényt kérdeztem”): a supervisornak szóló kérdés a korábbi témát viszi, nem a modell előző kérdését
