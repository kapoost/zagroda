---
id: wymiana-z-postacia
name: Wymiana z postacią
when: Zmiana dotyczy handlu, wymiany, cen albo tego, co postacie dają graczowi i za ile — kto z kim handluje, kiedy wymiana jest możliwa, co wolno przyjąć jako zapłatę.
files: game/src/core/tick.ts, game/src/core/types.ts, game/src/core/wymiana.ts
---

# Wymiana z postacią

## Gdzie leży punkt zaczepienia

`game/src/core/wymiana.ts` — i tego pliku **nie wolno zmieniać**. Jest na liście
zakazu zapisu razem z botem progresji, bo kurs nie jest pokrętłem rozgrywki, tylko
granicą ekonomii. Zmiany dotyczące wymiany robi się **wokół** niego:

- `game/src/core/tick.ts` → `doRozmowa()` — kiedy wymiana w ogóle dochodzi do skutku
- `game/content/npcs.json` → `gives` — co która postać może oddać (to są DANE)

## Czego nie wolno złamać

1. **Cenę liczy silnik, nigdy model i nigdy klient.** Do rdzenia przychodzi wyłącznie
   „co za co"; „ile" wylicza `oferty()` od nowa przy stosowaniu. Gdyby ilość dało się
   przysłać z zewnątrz, wymiana stałaby się pompą wartości.
2. **Wartość plecaka gracza nie może rosnąć na wymianie.** Pilnuje tego fuzz
   w `game/tests/invariants.test.ts`, którego nie wolno edytować.
3. **Narzędziem ani budynkiem się nie płaci.** Oddanie siekiery za jagodę byłoby dla
   gracza katastrofą, a postać nie ma prawa mu tego proponować.
4. **Darmowy dar tylko wtedy, gdy gracz nie ma czym zapłacić.** Inaczej rozmowa
   zamienia się w darmową kopalnię.

## Co wysłać koderowi jako kontekst

- `game/src/core/wymiana.ts` (do czytania, nie do zmiany)
- `game/src/core/tick.ts`
- `game/src/core/types.ts` (pole `Input.rozmowa`)

## Skąd to się wzięło

Postacie zaczęły handlować same z siebie, bo lore mówi, że wymiana odbywa się rzeczami
i przysługą. Model robił rzecz słuszną, tylko mechaniki pod to nie było — a próba
klasyfikowania jego zdań na „dał / nie dał" goniła ogon: „Wezmę w zamian" przechodziło
jako dar, a „Tutaj, masz jedną" już nie. Kategoria była zła. Model nigdy nie mówił
„dałem", tylko „dam X za Y".
