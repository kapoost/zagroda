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

Hybrydowa, a od niedawna **zasłużona**:

- **zmiana deklaratywna + zielona bramka + spełniony warunek intencji** → merge do `main`
- **zmiana deklaratywna bez warunku** → gałąź; nikt nie obiecał, czego dowodzić
- **warunek złamany po wszystkich rundach** → gałąź z notatką wprost, że to nie jest
  to, o co proszono
- **każdy patch kodu rdzenia** → gałąź i PR, czeka na człowieka

Agent nigdy nie pracuje na `main`. Przy porzuceniu zmiany gałąź znika razem z nią.

### Fasady: fakt z mapy, typologia z treści

Kamienice różnią się wyglądem, ale nikt nie zgaduje, co stoi pod którym adresem.
Podział pracy wynika z pomiaru na żywym modelu:

| źródło | co daje | dlaczego stamtąd |
| --- | --- | --- |
| OSM (`mapa.json`) | liczba kondygnacji, status zabytku, obrys | fakty o konkretnych budynkach: 185 z 265 ma zapisane piętra, 75 status zabytku |
| treść (`facades.json`) | tynk, dachówka, attyka, rytm arkad | typologia, czyli jedyne, o co model pytany ogólnie odpowiada poprawnie |
| `world.ts` | złączenie jednego z drugim | deterministyczne: gdy pasuje kilka archetypów, wybiera odcień budynku |

Bielik zapytany o pięć konkretnych kamienic Rynku Wielkiego wymienił tę samą
„Pod Małpą" dwa razy jako dwa różne budynki i dorysował dachy mansardowe miastu,
które słynie z attyk. Zapytany, po czym w ogóle poznać kamienicę z Zamościa,
odpowiedział poprawnie — i każda wymieniona cecha (głębokość podcieni, liczba
arkad, forma attyki, pastelowa kolorystyka) okazała się parametrem, nie opisem.
Schemat `FacadeSchema` jest zapisem tamtej odpowiedzi.

Kontrola `FASADA_DZIURA` jest odpowiednikiem `BIOME_HOLE`: każda kombinacja
liczby kondygnacji i statusu zabytku musi mieć archetyp, bo inaczej kamienica
wyrenderuje się jako dziura w pierzei.

### Zywa rozmowa z postaciami

Postacie odpowiadaja graczowi tekstem z Bielika, ale rdzen o tym nie wie i wiedziec
nie moze. `tick(state, input, registry)` jest czysta funkcja, a test determinizmu
porownuje hash po tysiacach tickow — wywolanie modelu jest asynchroniczne i
nieprzewidywalne, wiec w rdzeniu nie ma dla niego miejsca.

Rozwiazanie jest takie samo jak przy operacjach na tresci: **wybor modelu traktujemy
jak wejscie gracza, a nie jak logike gry.**

```
model mowi   →  tekst leci strumieniem do okna      (prezentacja, nie dotyka stanu)
model wybiera → Input.rozmowa = { npc, daj }        (wejscie, jak nacisniecie klawisza)
rdzen         →  sprawdza sasiedztwo i liste darow  (nie wierzy na slowo)
```

Wejscie juz jest niedeterministyczne, bo po drugiej stronie siedzi czlowiek. Test
determinizmu odtwarza ustalona sekwencje wejsc, wiec dopoki akcja przychodzi TA droga,
a nie bokiem, hash stanu dalej zgadza sie co do bitu. Gotowe kwestie z `dialogues`
zostaja jako deterministyczny wariant offline — gra dziala bez Ollamy.

Cztery rozstrzygniecia, kazde z pomiaru:

| co | dlaczego tak | liczba |
| --- | --- | --- |
| proza bez gramatyki | z gramatyka JSON model musi najpierw wypisac `{"reply": "` | 330 ms wobec 870 ms do pierwszej litery |
| decyzja osobnym wywolaniem | wspolne wywolanie odpowiadalo `brak` 4 razy na 4 | rozdzielone wybiera poprawnie |
| blok staly wpieczony w model | zamrozony prefiks trafia w cache KV | 80 ms wobec 25 s na przetworzenie promptu |
| wspolny watek dla obu wywolan | osobny prompt kasowal cache rozmowy | akcja 1,8 s zamiast 4,2 s |

Dwa filtry przed modelem, bo nie pyta sie modelu o to, co da sie sprawdzic:
**czasownik dawania** w kwestii (bez niego pytanie o dar w ogole nie pada) i
**pytanie dwustanowe** przed pytaniem o przedmiot — gramatyka zawezona do listy darow
kusi wybraniem czegokolwiek, pytanie `tak`/`nie` tej pokusy nie ma.

#### Zadania: kolekcja, ktora miala wyrocznie od pierwszej chwili

Pytanie „czy to moment na presety" mialo zla przeslanke. Dziennik pokazal **24 przebiegi
i tylko 8 roznych promptow**, wszystkie tego samego ksztaltu: „dodaj narzedzie lepsze od
istniejacego". Sufitu nie dotknelismy — nie testowalismy go.

Za to **piec pol schematu nie robilo nic**: `storage`, `stack`, `likes`, `seasons`,
`tags`. To gorsze od sufitu. Sufit mowi „nie"; martwe pole mowi „tak" i klamie —
agent zbudowal kosz ze schowkiem na 30 rzeczy, a skrzynie nie przechowywaly NICZEGO.
Dlatego przed kazda rozbudowa idzie porzadek: **pole albo cos robi, albo go nie ma**.

Dopiero potem kolekcja `zadania` — i nie dlatego, ze „brakowalo zadan", tylko dlatego,
ze to jedyna nowa kolekcja, ktora **sklada rzeczowniki, ktore juz sa** (przedmiot,
postac, struktura, miejsce z mapy) i ma wyrocznie: bot potrafi zdobyc dowolny przedmiot,
wiec potrafi tez wziac zadanie, spelnic warunek i oddac. Bramka dowodzi wykonalnosci
zadania tak samo, jak dowodzi wykonalnosci receptury.

Waski kontrakt od pierwszej wersji:

| | |
| --- | --- |
| rodzaje warunku | `miec`, `postawic`, `dojsc` — i nic wiecej |
| ksztalt | **plaski**, nie unia: koszt gramatyki rosnie szybciej niz liniowo |
| nagroda | najwyzej 2× tego, co gracz wlozyl (`NAGRODA`) |
| powtarzalnosc | **jednorazowe** — powtarzalne z zyskiem to pompa wartosci |
| interfejs | zaden: zadania wchodza ta sama spacja, co reszta |

Warunek typu „pomoz Hance" nie wchodzi, bo nikt nie umie orzec, kiedy jest spelniony.
Zadanie bez wyroczni byloby kolejnym `storage`.

**Co ta wyrocznia znalazla od razu:** na seedzie 1337 **Hanka byla odcieta od swiata** —
stala w zamknietym podworzu miedzy kamienicami, przechodnim w srodku i bez wejscia.
Kowalka, od ktorej zalezy caly lancuch zelaza. Bot progresji tego nie widzial przez cale
zycie projektu, bo zelazo zdobywa sie bez rozmowy z nia. Zobaczyl dopiero wtedy, gdy po
raz pierwszy musial do niej DOJSC.

Poprawka dotyczy reguly, nie Hanki: swiat rozstawia encje wylacznie w **najwiekszym
spojnym obszarze przechodnim**, a nie na „dowolnym kaflu, po ktorym da sie chodzic".
Surowiec w zamurowanym podworzu wyglada w grze jak tresc, a zachowuje sie jak jej brak.

#### Postacie historyczne: nazwy z mapy, glos od modelu

Trzy osoby opowiadaja o okolicy: **Morando** (budowniczy, ktory rysowal plan miasta),
**Szymon** (poeta chodzacy za Akademia) i **Rudomicz** (profesor, ktory wszystko notuje).

Material faktyczny nie pochodzi z pamieci modelu, bo ta w tej dziedzinie zawodzi
w sposob trudny do wykrycia. Bielik zapytany wprost o kamienice Rynku Wielkiego
wymienil te sama „Pod Malpa" dwa razy jako dwa rozne domy i polaczyl prawdziwa
Kamienice Wilczkowska z prawdziwa Pod Aniolem w jeden budynek. Brzmialo wiarygodnie.

Nazwy leza w danych, ktore i tak pobieralismy — wyrzucalismy je przy imporcie:

```
58 nazwanych zabytkow w kadrze, prosto z tagow OSM
Ratusz · Rynek Wielki · Kamienica Pod Malzenstwem (Szafirowa)
Kamienica Pod Aniolem (Bartoszewiczow) · Kamienica Morandowska I
Synagoga · Stara Brama Lubelska · Nadszaniec VII · Palac Zamoyskich …
```

Podzial jest ten sam, co przy fasadach i przy cenniku wymiany:

| skad | co | dlaczego stamtad |
| --- | --- | --- |
| `mapa.json` → `miejsca` | nazwy i polozenia zabytkow | fakty, sprawdzalne, z OSM |
| `npcs.json` → `wiedza` | co postac wie o miescie | zapisane recznie, nie zgadywane |
| gra, w czasie rozmowy | co widac stad: nazwa, odleglosc, kierunek | liczone z pozycji gracza |
| model | glos, ton, dobor slow | to jedyne, w czym jest dobry |

Prompt mowi wprost: *o budynkach podawaj nazwe i kierunek, nic wiecej*. Bez tej reguly
Morando dopowiadal kamienicom kolory i ulice, ktorych w danych nie ma — a zmyslony
szczegol brzmi tak samo jak prawdziwy.

#### Wymiana: model wybiera co za co, silnik liczy ile

Postacie zaczely handlowac same z siebie, bo lore mowi, ze wymiana odbywa sie rzeczami
i przysluga. Model robil rzecz sluszna, tylko mechaniki pod to nie bylo — a proba
klasyfikowania jego zdan na „dal / nie dal" gonila ogon: *„Wezme w zamian"* przechodzilo
jako dar, a *„Tutaj, masz jedna"* juz nie. **Kategoria byla zla**: model nigdy nie mowil
„dalem", tylko „dam X za Y".

Kurs mieszka w `game/src/core/wymiana.ts`, **niezapisywalnym dla agenta** razem z botem
progresji. Cena to nie pokretlo rozgrywki, tylko granica ekonomii — zapisywalny kurs to
pompa wartosci: ryba warta piec za galaz warta jeden, w kolko.

```
oferty(state, reg, npc)  →  lista wymian, policzona z wartosci przedmiotow
        │                        │
   do promptu modelu        do walidacji w tick()
   (zeby mowil te same      (bo to samo liczymy drugi raz,
    liczby, co gra)          wiec rozjazd nie ma gdzie powstac)
```

Do rdzenia przychodzi wylacznie `{ npc, daj, za }` — **bez ilosci**. Ilosc jest
przeliczana od nowa, wiec podrobiony kurs po prostu nie istnieje: ani z modelu, ani
z przegladarki, ani z konsoli.

#### Bot handluje, zeby miec czym zepsuc

Dopoki bot progresji nie umial rozmawiac, cala ekonomia dialogu byla dla symulacji
niewidzialna — i przezyla w niej pompa wartosci: gracz z jedna galezia dostawal
nieskonczenie wiele ryb przy siedmiu zielonych etapach bramki.

`Bot.wyzyskuj()` nie jest strategia gry. Bot zbiera troche towaru, a potem bierze
KAZDA dostepna wymiane, ile sie da, i raportuje wartosc plecaka przed i po. Symulacja
przestala byc samym raportem: `po > przed` to **blokada**, nie metryka.

```
seed 1337  ✓ handel  53 wymian  wartość 84 → 29
```

Oracle sprawdzony mutacja: zamiana `Math.ceil` na `Math.floor` w cenie — czyli
zaokraglenie na korzysc gracza — daje `84 → 190` i bramka staje na czerwono. Drugi
test pilnuje, ze bot naprawde handluje: wyrocznia, ktora nic nie robi, przechodzi
zawsze, wiec „brak pompy" przy zerowej liczbie wymian byloby prawda pusta.

Cennik idzie do promptu na SAM KONIEC, tuz przed kwestia gracza. Dwa powody: zalezy od
zawartosci plecaka, wiec w stalym poczatku psulby cache, a ostatnie miejsce przed
generowaniem jest najmocniejsze. Gdy stal na poczatku, Bartek wycenial rybe na „piec
galezi albo osiem kamieni" — piatke bral z cennika, osemke ze stanu plecaka gracza.

Czego tu nie ma i nie bedzie: wyroczni jakosci. Nikt automatycznie nie sprawdzi, czy
postac nie wyszla z roli albo nie nazwala Bartka kowalem, gdy kowalka jest Hanka —
a nazwala. Mechanicznie da sie sprawdzic tylko to, czy wybrana wymiana jest na liscie.

**Rozmowy wykluczaja agenta.** Ollama traktuje `zagroda-npc` i model bazowy jako dwa
osobne modele po 8,5 GB, wiec na 24 GB bija sie o miejsce: pierwszy token spadl z
330 ms do 34 sekund. Rozmowa zwalnia modele agenta, zanim zacznie.

**Po kazdej zmianie tresci: `npm run npc-model`.** Model trzyma receptury wpieczone
w blok systemowy, wiec zbudowany na starszej tresci opowiada o grze, ktorej juz nie ma.
Pilnuje tego odcisk tresci — rozmowa odmawia pracy, gdy sie nie zgadza.

### Warunek intencji

Bramka dowodzi, że treść jest spójna. Nie dowodzi, że jest TA, o którą proszono —
i tą dziurą wszedł kiedyś na `main` młot „dużo wytrzymalszy od kilofa"
z wytrzymałością 30 przy kilofie 200. Każda liczba z osobna mieściła się w zakresie.

Routing wypisuje więc to samo zdanie dwa razy: raz po polsku (`observable_pl`),
raz jako porównanie, które policzy automat:

```
items.wedka_zelazna.tool.durability > items.wedka.tool.durability
```

Składnia jest celowo mała — większą model zacznie zgadywać. Ścieżka, której nie da
się rozwiązać, jest **błędem, nie prawdą**: asercja, której nie umiemy sprawdzić,
udaje dowód i tym jest gorsza od jej braku.

Warunek trafia do promptu operacji **przed** pierwszą próbą. Zanim tak było, model
trafiał w liczbę metodą prób — wytrzymałość 50, potem 150, potem 300 — i rundy
kończyły się, zanim zobaczył, czego od niego chcemy.

## Czego bramka nie złapie

Lista kontroli rośnie wyłącznie po przebiegach na żywo i to jest w niej najważniejsze.
Każda powstała dlatego, że coś przeszło, a nie powinno:

| kontrola | co przepuściła, zanim powstała |
| --- | --- |
| `ROLA` | kosz, który był schowkiem, narzędziem i jedzeniem naraz |
| `BEZ_ZASTOSOWANIA` | przedmiot, którego nie dało się do niczego użyć |
| `DOMINACJA` | młot droższy od kilofa i od niego gorszy pod każdym względem |
| `KOSZT_POSTEPU` | żelazną kosę lepszą od zwykłej za identyczną recepturę |
| `STRUKTURA_SIEROTA` | stanowisko rybackie, którego żaden przedmiot nie stawia |
| zamknięty słownik tagów | tag `narzucie` |

Dwie z nich powstały po przeglądzie pierwszej scalonej zmiany,
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
