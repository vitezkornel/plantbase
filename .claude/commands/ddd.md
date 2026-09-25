---
description: DDD domain-doksi auditálása
argument-hint: '[honnan nézzük, pl. HEAD~10]'
allowed-tools: Read, Edit, Write, Bash(git:*), Skill
---

Futtasd a `ddd-audit` skillt a `docs/ddd/glossary.md` és a `docs/ddd/model.md` auditálására.

A git history kiindulópontja (`<base>`) a skill 1. lépésében:

- Ha az argumentum nem üres, ezt használd: `$ARGUMENTS` — a vizsgált tartomány `$ARGUMENTS..HEAD`.
- Ha az argumentum üres, az utolsó néhány commit változásait nézd: `<base>` = `HEAD~5` (ha ennyi commit sincs, a teljes history).

Ez felülírja a skill alapértelmezett kiindulópontját (a `docs/ddd/` utolsó módosító commitját). Minden más lépést és szabályt a skill szerint kövess: csak a domain-modellt dokumentáld, üzleti döntést ne írj felül, csak javasolj, és ne commitolj.
