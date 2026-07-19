# ROI-levezetés: plantbase agent egy 5 fős lakberendező-irodában

## Kiindulási adatok

A brs-plantbase.md alapján, 1 lakberendezőre vetítve:
- havi 5 ügyfél, ügyfelenként átlag 3 szoba → havi 15 szoba/fő
- kézi feldolgozás: átlag 12,5 perc/szoba (a dokumentált 10-15 perc középértéke)

5 fős iroda esetén (azonos terheléssel):
- havi 75 szoba összesen (15 szoba/fő × 5 fő)

## Időmegtakarítás a plantbase agenttel

A BRS KPI-ja szerint az agenttel 1 szoba < 5 perc alatt intézhető.
- Kézi: ~12,5 perc/szoba
- Agenttel: ~5 perc/szoba
- Megtakarítás: ~7,5 perc/szoba

Havi megtakarított idő:
75 szoba × 7,5 perc = 562,5 perc ≈ 9,4 óra/hó

Feltételezett betöltött órabér (bér+járulék) egy lakberendezőnél: 7.000 Ft/óra (becslés, iparági középérték).

Havi időmegtakarítás pénzben:
9,4 óra × 7.000 Ft ≈ 65.800 Ft/hó
Éves szinten: 65.800 × 12 ≈ 789.600 Ft/év

## Kiegészítő megtakarítás: olcsóbb beszerzés

A BRS szerint az agent mindig a legjobb ár-érték arányú növényt/akciót találja meg. Konzervatív becsléssel:
- 25 ügyfél/hó (5 ügyfél/fő × 5 fő)
- átlagos ügyfélkosár: 30.000 Ft
- becsült megtakarítás az agent általi jobb ár-összehasonlítással: 2,5%

Havi megtakarítás:
25 × 30.000 Ft × 2,5% ≈ 18.750 Ft/hó
Éves szinten: ≈ 225.000 Ft/év

## Összesített éves megtakarítás (5 fős iroda)

| Tétel | Éves megtakarítás |
|---|---|
| Időmegtakarítás | ~789.600 Ft |
| Olcsóbb beszerzés | ~225.000 Ft |
| **Összesen** | **~1.014.600 Ft/év** |

## Soft ROI (nehezen forintosítható, de valós hatás)

- Magasabb ügyfélélmény: gyorsabb, pontosabb ajánlat, rövidebb várakozási idő
- Jobb minőségű munka: pontosabb illeszkedés a szoba adottságaihoz és az ügyfél igényeihez
- Skálázhatóság: az iroda új munkatársai gyorsabban tudnak önállóan, SQL-tudás nélkül dolgozni a katalógussal

## Megjegyzés a becslésekhez

A fenti számítás konzervatív, kerekített becsléseket használ (órabér, kedvezmény-arány), a brs-plantbase.md dokumentált idő- és ügyfélszám-adataira építve. A tényleges megtakarítás irodánként eltérhet a helyi bérszint és ügyfélkör alapján.
