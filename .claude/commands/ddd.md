---
description: DDD domain-doksi auditálása
argument-hint: '[opcionális kiindulópont, pl. HEAD~10 — alapból a legutóbbi audit óta]'
allowed-tools: Read, Edit, Write, Bash(git:*), Skill
---

Futtasd a `ddd-audit` skillt a `docs/ddd/glossary.md` és a `docs/ddd/model.md` auditálására.

A git history kiindulópontja (`<base>`) a skill 1. lépésében:

- Ha az argumentum üres (alapeset): a skill saját szabálya szerint a `docs/ddd/.last-audit` jelölőfájlból — vagyis csak azt nézd, amit még egyetlen audit sem vizsgált meg (érvénytelen vagy hiányzó jelölőnél a skill tartalékszabálya érvényes).
- Ha az argumentum nem üres, ez felülírja a jelölőt: `<base>` = `$ARGUMENTS`, a vizsgált tartomány `$ARGUMENTS..HEAD`.

A futás végén mindkét esetben frissítsd a jelölőfájlt a skill 4. lépése szerint. Minden más lépést és szabályt a skill szerint kövess: csak a domain-modellt dokumentáld, üzleti döntést ne írj felül, csak javasolj, és ne commitolj.
