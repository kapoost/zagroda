# Dziennik zmian

Każdy wpis to jedna zmiana przepuszczona przez bramkę jakości.

## Dodanie kosza wiklinowego
*2026-10-27 12:07 · dane · wykonawca: bielik*

Gracz prosi o dodanie nowego przedmiotu - kosza wiklinowego, który będzie pojemnym schowkiem plecionym z trzciny i pomieści więcej niż zwykła skrzynia.

- + items: kosz_wiklinowy ("Kosz wiklinowy")
- + items: wypelnienie_kosza ("Wypełnienie kosza")
- + recipes: r_kosz_wiklinowy ("Kosz wiklinowy")
- + recipes: r_wypelnienie_kosza ("Wypełnienie kosza")
- + structures: kosz_wiklinowy ("Kosz wiklinowy")

## Koszt zbierania surowców w nocy
*2026-10-27 14:14 · kod · wykonawca: coder*

Zmiana wprowadza modyfikację kosztu akcji zbierania surowców w zależności od pory dnia. Zbieranie surowców w nocy będzie kosztować gracza dwukrotnie więcej sił niż w ciągu dnia.

- ~ kod: game/src/core/tick.ts

## Dodanie kamiennego młota
*2026-10-27 15:58 · dane · wykonawca: bielik*

Gracz może teraz wytwarzać nowe narzędzie - kamienny młot, który jest wytrzymalszy od kilofa, ale zadaje mniejsze obrażenia. Wymaga to dodania nowego przedmiotu do listy dostępnych przedmiotów oraz aktualizacji receptur i statystyk narzędzi.

- + items: mlot_kamienny ("Kamienny młot")
- + recipes: r_mlot_kamienny ("Kamienny młot")
