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
