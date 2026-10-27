# Architektura

## Problem

Model ogólnego przeznaczenia ma rozwijać grę przez miesiące i jej nie zepsuć.
Bielik nie jest modelem koderskim — w generowaniu poprawnych diffów i w tool-callingu
zawodzi często, nie sporadycznie. Architektura jest odpowiedzią właśnie na to.

## Trzy decyzje, na których wszystko stoi

### 1. Powierzchnia zmian jest deklaratywna

Większość tego, co gracz chce dodać — broń, potrawa, budynek, postać — to wpis
w JSON-ie, nie kod. Model nigdy nie pisze plików danych. Emituje operacje:

```json
{ "add_items": [{ "id": "fujarka", "name": "Fujarka", "value": 8 }],
  "add_recipes": [{ "id": "r_fujarka", "station": "workbench", ... }] }
```

Stosuje je `agent/src/stages/applyData.ts` — zwykły, deterministyczny kod.
Najgorsze, co model może zrobić, to zaproponować spec, którą odrzuci schemat
albo bramka. Nie może zostawić repozytorium w stanie pośrednim.

### 2. Schemat jest wąski i budowany na żądanie

Model 11B radzi sobie z gramatyką na trzy pola; z unią trzynastu operacji już nie.
Stąd dwie fazy:

| Faza | Wejście | Schemat | Wyjście |
| --- | --- | --- | --- |
| routing | polski opis | 6 pól | DANE/KOD + które kolekcje |
| operacje | opis + skrót treści | tylko wybrane kolekcje | wpisy do dodania |

Ollama wymusza gramatykę przez pole `format`, więc JSON jest poprawny
składniowo zawsze. Sens merytoryczny weryfikuje dopiero bramka.

Kolekcje są dopełniane o zależności: przedmiot do postawienia wymaga wpisu
w `structures`, przedmiot do wytworzenia — w `recipes`. Model regularnie o tym
zapomina, a bez dopełnienia pętla poprawek nie miałaby czym naprawić bramki.

### 3. Operacje ryzykowne nie istnieją, dopóki ktoś o nie nie poprosi

`remove` i `patch_*` pojawiają się w schemacie wyłącznie wtedy, gdy faza routingu
ustawi `removes_content` albo `modifies_existing`. Model, który nie ma jak usunąć
ani załatać wpisu, nie zrobi tego przez przypadek.

To nie jest ostrożność na zapas — oba tryby awarii wystąpiły w pierwszych przebiegach.
Przy prośbie o nowy schowek model skasował istniejącą skrzynię, a w kolejnej rundzie
próbował łatać identyfikator, którego w grze nie ma. Żadna reguła w prompcie tego nie
powstrzymała; usunięcie gałęzi ze schematu — tak. Przy okazji gramatyka dla typowej
zmiany spadła z 5,7 do 2,7 kB, co bezpośrednio przyspiesza dekodowanie pod gramatyką.

## Bramka jakości

Cztery etapy, fail-fast, od najtańszego:

**Spójność treści** (`game/src/content/registry.ts`) — to nie jest walidacja
kształtu, tylko całości:

- każda referencja się rozwiązuje (wsad receptury, łup surowca, struktura przedmiotu)
- graf receptur jest acykliczny
- **osiągalność progresji**: punkt stały po narzędziach i stanowiskach. Każdy przedmiot
  musi dać się zdobyć startując z gołymi rękami. Przedmiot bez drogi zdobycia to błąd.
- **pokrycie biomów**: każdy punkt przestrzeni (wysokość, wilgotność) ma przypisany biom
- **ekonomia**: wartość wyjścia receptury ≤ 4× wartość wsadu — nie da się zrobić
  drukarki pieniędzy
- **spójność ról**: przedmiot stawiany w świecie nie jest narzędziem ani jedzeniem,
  narzędzie nie jest jedzeniem, `"hand"` to brak narzędzia a nie jego rodzaj
- **brak ślepych uliczek**: każdy przedmiot ma rolę albo jest zużywany przez recepturę

**Typy** — `tsc --noEmit` dla gry i agenta.

**Testy** — determinizm (hash stanu), inwarianty pod losowym wejściem na wielu seedach,
i progresja: bot startuje z pustym ekwipunkiem i musi dojść do kamieni milowych.
Testy negatywne w `content.test.ts` sprawdzają, czy walidator nadal łapie psucie —
jeśli któryś przestanie przechodzić, agent dostał cichą furtkę.

**Symulacja** — metryki do changeloga: ile ticków zajmuje dojście do siekiery,
warsztatu, sztabki żelaza. Widać, czy zmiana nie wydłużyła progresji dwukrotnie.

## Drabina eskalacji

```
DANE:  Bielik ─(JSON niepoprawny)─► Bielik ─► API
         │
         └─(bramka czerwona)─► Bielik z komunikatem błędu ─► … ─► API
KOD:   Qwen-Coder ×3 ─(bramka czerwona za każdym razem)─► API ×2 ─► porzucenie
```

Błędy z bramki wracają do modelu dosłownie — nie streszczone. Komunikat
`[UNREACHABLE_ITEM] items.fujarka: item "fujarka" jest nieosiągalny w rozgrywce`
jest dla modelu znacznie użyteczniejszy niż „popraw to".

## Skille: wiedza projektowa poza modelem

Model kodujący dostaje brief wyrenderowany z pliku `agent/skills/<id>.md`, wybranego
przez Bielika z menu opisów „kiedy to ten rodzaj zmiany". Skill wskazuje też, które
pliki rdzenia wysłać jako kontekst — dwa zamiast sześciu to nie tylko oszczędność
tokenów, ale i mniejsza okazja, żeby model zmienił coś, o co nikt nie prosił.

Lekcja, która doprowadziła do tego kształtu: przy pierwszym udanym patchu Qwen napisał
`isNight = t > 0.5 && t < 0.75`, czyli nazwał nocą popołudnie, choć skill tłumaczył
konwencję liczbową. Bramka przepuściła — determinizm i granice energii były zachowane.
Wniosek nie brzmiał „model jest słaby", tylko **„to nie było pytanie, na które miał
odpowiadać"**. Granica nocy jest decyzją tej gry, więc mieszka w rdzeniu jako `isNight()`,
a skille wskazują helper zamiast tłumaczyć liczby. Następny przebieg wyszedł poprawnie.

Reguła ogólna: jeśli model uporczywie zgaduje, sprawdź najpierw, czy nie każesz mu
zgadywać czegoś, co powinno być zapisane.

## Patche kodu: format SEARCH/REPLACE

Pierwsza wersja kazała modelowi zwracać pełne treści plików. Qwen potrzebował na to
721 sekund i dziesięciu tysięcy znaków, żeby zmienić trzy linijki — a przy pliku dwa
razy większym nie zmieściłby się w oknie w ogóle.

Druga wersja używała wymyślonych przeze mnie znaczników `<<<OLD>>>` / `<<<NEW>>>`.
Model brał znacznik i wsadzał w niego cały plik, bo tego formatu nie widział nigdy
w treningu.

Trzecia używa `SEARCH/REPLACE` — standardu, który modele koderskie znają:

```
game/src/core/tick.ts
<<<<<<< SEARCH
  const cost = reg.content.config.energyPerAction;
=======
  const cost = computeCost(state, reg);
>>>>>>> REPLACE
```

Koszt generowania przestał zależeć od rozmiaru pliku — to zmiana klasy złożoności,
nie optymalizacja.

Dopasowanie jest **tolerancyjne, ale jednoznaczne**: najpierw dosłowne, potem linia po
linii z pominięciem białych znaków (model regularnie myli wcięcie), z zachowaniem
wcięcia z pliku. Dwa pasujące miejsca to nadal błąd — zgadywanie, które model miał na
myśli, jest gorsze niż prośba o doprecyzowanie.

Ścieżki przechodzą przez `canWriteCode()`. Lista zakazu wygrywa z listą dozwoleń.

## Autonomia

Hybrydowa:

- **zmiana czysto deklaratywna + zielona bramka** → merge do `main` automatycznie
- **każdy patch kodu rdzenia** → gałąź i PR, czeka na człowieka

Agent nigdy nie pracuje na `main`. Przy porzuceniu zmiany gałąź znika razem z nią.

## Czego bramka nie złapie

Dwie ostatnie kontrole powstały dopiero po przeglądzie pierwszej scalonej zmiany,
i to jest pouczające. Bielik dodał kosz, który przeszedł wszystkie cztery etapy
i był jednocześnie schowkiem, narzędziem ręcznym i jedzeniem — bo spłaszczenie
gramatyki (patrz wyżej) zamieniło pola opcjonalne w wymagane, a model zamiast
wpisać null zaczął je wymyślać. Poprawka wydajnościowa stworzyła problem
merytoryczny; luka była jednak nazywalna i domknięta w kilkanaście minut.

Co nadal zostaje poza zasięgiem bramki: czy zmiana realizuje to, o co gracz prosił.
„Mieści więcej niż skrzynia" to wymaganie, którego walidator nie sprawdzi — może
jedynie potwierdzić, że schowek istnieje i ma jakąś pojemność. Przegląd człowieka
albo mocniejszy model na szczeblu eskalacji to jedyne miejsca, gdzie taka rzecz
wychodzi na jaw.

## Co jest słabym punktem

**Skuteczność Bielika w fazie operacji.** Routing trafia; generowanie spójnego
zestawu wpisów to loteria. Bramka to wyłapuje, więc gra jest bezpieczna — ale wiele
zmian kończy się porzuceniem. To główny kierunek dalszej pracy: lepsze przykłady
w prompcie, a docelowo dostrojenie modelu na własnym dzienniku prób
(`.agent/journal.jsonl` notuje każdą próbę i jej wynik).

**Czas.** Jedno wywołanie modelu 11B to 60–90 sekund. Pełna zmiana z dwiema rundami
poprawek to kilka minut. Nie jest to pętla do pracy interaktywnej.
