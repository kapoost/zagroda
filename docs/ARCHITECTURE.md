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

## Patche kodu: protokół tekstowy, nie JSON

Model kodujący musiałby escapować cały plik TypeScript w stringu JSON — w praktyce
psuje to co drugą odpowiedź. Zamiast tego znaczniki odporne na cudzysłowy,
backslashe i wielolinijkowe stringi:

```
<<<FILE game/src/core/tick.ts>>>
...pełna treść pliku...
<<<END>>>
```

Ścieżki przechodzą przez `canWriteCode()`. Lista zakazu wygrywa z listą dozwoleń.

## Autonomia

Hybrydowa:

- **zmiana czysto deklaratywna + zielona bramka** → merge do `main` automatycznie
- **każdy patch kodu rdzenia** → gałąź i PR, czeka na człowieka

Agent nigdy nie pracuje na `main`. Przy porzuceniu zmiany gałąź znika razem z nią.

## Co jest słabym punktem

**Skuteczność Bielika w fazie operacji.** Routing trafia; generowanie spójnego
zestawu wpisów to loteria. Bramka to wyłapuje, więc gra jest bezpieczna — ale wiele
zmian kończy się porzuceniem. To główny kierunek dalszej pracy: lepsze przykłady
w prompcie, a docelowo dostrojenie modelu na własnym dzienniku prób
(`.agent/journal.jsonl` notuje każdą próbę i jej wynik).

**Czas.** Jedno wywołanie modelu 11B to 60–90 sekund. Pełna zmiana z dwiema rundami
poprawek to kilka minut. Nie jest to pętla do pracy interaktywnej.
