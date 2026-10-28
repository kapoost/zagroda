# Zagroda

Otwarty świat w przeglądarce — zbieranie, wytwarzanie, budowanie — który rozwija
**Bielik**, polski model językowy działający lokalnie.

Świat nie jest wymyślony: to Stare Miasto w Zamościu, wczytane z OpenStreetMap.
Siatka kafli jest obrócona o zmierzone 13,93°, więc ulice biegną prosto, a kamienice
stoją równo w pierzejach.

Opisujesz zmianę po polsku. Model ją klasyfikuje, proponuje, system ją stosuje
i testuje. Jeśli coś się psuje, zmiana nie wchodzi.

```bash
npm install
npm start                   # gra + pętla agenta + kontrola wstępna
npm run zu -- "dodaj drewnianą fujarkę, NPC lubią gdy im zagrasz"
```

## Jak to działa

```
opis po polsku
      │
      ▼
  Bielik 11B ──► klasyfikacja: DANE czy KOD?
      │
      ├─ DANE ─► Bielik proponuje operacje ─► deterministyczny applier ─► treść gry
      │
      └─ KOD ──► Qwen2.5-Coder 14B pisze patch ─► pliki rdzenia
                         │
                         ▼
                   BRAMKA JAKOŚCI
          schematy → typy → testy → symulacja
                         │
            zielona ─────┴───── czerwona
               │                    │
        commit na gałęzi      błędy wracają
               │              do modelu, kolejna runda
     ┌─────────┴─────────┐          │
  dane:              kod:      po wyczerpaniu prób
  warunek intencji   PR        gałąź znika, main nietknięty
  spełniony?
   tak → main
   nie → gałąź
```

Orkiestracja jest deterministyczna. Model nie jest agentem — dostaje wąskie,
walidowalne zadania. To jedyny sposób, w jaki model ogólnego przeznaczenia może
rozwijać grę i jej nie zepsuć.

## Jak to pokazać

Trzy poziomy, każdy pokazuje co innego:

| poziom | czego wymaga | co widać |
| --- | --- | --- |
| **statyczna gra** | `npm run build`, dowolny hosting | pełna rozgrywka: ruch, zbieranie, wytwarzanie, zadania, wymiana, kwestie postaci |
| **gra + dowody** | to samo — dowody są w paczce | pracownia staje się eksponatem: prompt, dziennik przebiegów, wynik bramki |
| **pełny `npm start`** | Ollama i 8,5 GB modelu | żywe rozmowy po polsku i prawdziwe zgłaszanie zmian |

Paczka ma **211 kB** (57 kB po gzipie) i zawiera całą mapę Zamościa — zero zapytań
sieciowych przy starcie.

Gra sprawdza raz, czy ma z kim rozmawiać, i od tego zależy, co pokazuje. Bez modelu
znika pole do pisania i przycisk „Wyślij do Bielika", bo **przycisk, który nie może
zadziałać, jest gorszy od jego braku**. Zostaje wymiana — kurs i tak liczy silnik, więc
nie zależy od niczego poza treścią gry.

Dowody odświeża `npm run dowody` (robi to też `npm run build`): prompt klasyfikacji
powstaje z tej samej funkcji, co w pętli, a dziennik i wynik bramki pochodzą z `.agent/`.

## Co dostaje model

Rozwijanie gry modelem bez wglądu w prompt jest rzucaniem zdania w ciemno, więc prompt
da się obejrzeć z dwóch stron — i składa go **ta sama funkcja**, która składa go naprawdę:

```
npm run zu -- --prompt "dodaj gliniany dzban na wodę"
```

wypisze krok po kroku: blok systemowy, blok użytkownika i gramatykę dekodowania, z
liczbą znaków i przybliżoną liczbą tokenów. Krok klasyfikacji renderuje się bez żadnego
wywołania modelu; prompty tworzące treść wymagają jednego pytania do Bielika, bo
zależą od tego, które kolekcje wybrał.

To samo jest w grze: **P** otwiera pracownię, a w niej *„Pokaż prompt, który dostanie
model"*.

## Skille briefowania kodera

Wiedza o tym, **jak zabrifować model kodujący**, nie siedzi w wagach Bielika, tylko
w plikach pisanych ręcznie — `agent/skills/*.md`. Bielikowi zostaje klasyfikacja
(„który to rodzaj zmiany") i wypełnienie dwóch slotów, czyli to, co robi bezbłędnie.

Każdy skill niesie trzy rzeczy, których model nie ma skąd wiedzieć:

| | |
| --- | --- |
| gdzie zaczepić | „zużycie energii przechodzi przez `spend()` w `tick.ts`" |
| czego nie łamać | „koszt nigdy poniżej 1 — inaczej bot progresji zapętla się" |
| które pliki wysłać | 2–3 zamiast całego rdzenia |

Dopisanie skilla kosztuje pięć minut i nie wymaga ani jednej pary treningowej. Gdy
jakiś rodzaj zmiany uporczywie nie wychodzi, odpowiedź brzmi „dopisz skill", a nie
„zbierz dane i trenuj". Gdy żaden nie pasuje, pętla mówi to wprost — i to jest lista
zadań na przyszłość.

## Dlaczego to działa

**Większość zmian to dane, nie kod.** Nowa broń, surowiec, potrawa, budynek czy
postać to wpisy w `game/content/*.json` walidowane schematami Zod. Model nie pisze
tych plików — emituje deklaratywne operacje, a stosuje je zwykły kod.

**Bramka jest niezapisywalna dla agenta.** Schematy, walidator, testy i sama bramka
leżą poza dozwoloną powierzchnią zmian. Najprostsza droga do zielonego światła to
naprawienie kodu, nie rozmontowanie testów.

**Testy sprawdzają grywalność, nie tylko spójność.** Bot progresji startuje z pustym
ekwipunkiem i musi dojść do każdego kamienia milowego. Receptura, której w praktyce
nie da się wykonać, pęknie tutaj — nawet jeśli schematy są zielone.

**Komunikat błędu jest interfejsem.** Czyta go model, który ma zmianę poprawić, więc
walidator nie mówi „nie ma itemu trzcina", tylko „trzcina to surowiec rosnący w świecie,
nie przedmiot — użyj tego, co z niego wypada: wlokno". Ta jedna zmiana przeniosła pętlę
z „trzy rundy, ten sam błąd" do „druga runda, zielono".

## Model danych

| Plik | Co opisuje |
| --- | --- |
| `game/content/items.json` | przedmioty: narzędzia, jedzenie, półprodukty, rzeczy do postawienia |
| `game/content/recipes.json` | receptury: wsad, wynik, stanowisko, czas |
| `game/content/resources.json` | surowce w świecie: biom, gęstość, narzędzie, łup |
| `game/content/structures.json` | budynki: stanowiska wytwórcze, schowki, ściany |
| `game/content/biomes.json` | biomy: kolor, przechodniość, zakres wysokości i wilgotności |
| `game/content/npcs.json` | postacie: dom, upodobania, kwestie |
| `game/content/config.json` | parametry świata: rozmiar, seed, długość doby, energia |

## Polecenia

| Komenda | Działanie |
| --- | --- |
| `npm start` | **wszystko naraz**: gra, pętla agenta i kontrola wstępna |
| `npm run dev` | sama gra w przeglądarce |
| `npm run npc-model` | przebuduj model rozmów — po każdej zmianie treści |
| `npm run gate` | pełna bramka jakości |
| `npm test` | same testy |
| `npm run sim` | raport progresji: ile ticków do kamieni milowych |
| `npm run zu -- "..."` | zmiana opisana po polsku |
| `npm run zu -- --dry "..."` | sama klasyfikacja, bez zapisu |
| `npm run zu -- --prompt "..."` | dokładny prompt, który dostanie model |

## Modele

| Rola | Model | Dlaczego ten |
| --- | --- | --- |
| polski ↔ struktura | Bielik 11B v3.0 (Q5_K_M) | trenowany na polskim korpusie; rozumie opisy i pisze teksty do gry |
| patche kodu | Qwen2.5-Coder 14B | dostaje prompty po angielsku, zwraca kod |
| eskalacja | Claude Opus 5 | wchodzi, gdy lokalne modele nie dadzą rady po N próbach |

Eskalacja do API jest opcjonalna — bez `ANTHROPIC_API_KEY` pętla działa wyłącznie
lokalnie, tylko z niższą skutecznością.

```bash
ollama pull hf.co/speakleash/Bielik-11B-v3.0-Instruct-GGUF:Q5_K_M
ollama pull qwen2.5-coder:14b
```

## Czego się spodziewać

To nie jest pętla do pracy interaktywnej. Jedno wywołanie modelu 11B z gramatyką JSON
trwa dziesiątki sekund do kilku minut; pełna zmiana z rundą poprawek to kilka minut.

Skuteczność też warto znać z góry. Faza klasyfikacji (dane czy kod, które kolekcje)
jest niezawodna. Faza generowania wpisów bywa loteryjna — bramka to wyłapuje, więc gra
jest bezpieczna, ale część zmian kończy się porzuceniem gałęzi. Każda próba trafia do
`.agent/journal.jsonl` razem z powodem porażki; to materiał na przyszłe dostrojenie
modelu albo na lepsze przykłady w prompcie.

## Licencja

Kod: **MIT** (plik `LICENSE`).

Dane mapy to osobna sprawa. `game/content/mapa.json` jest bazą pochodną z
OpenStreetMap i podlega **ODbL 1.0** — razem ze wszystkim, co z niej powstaje.
Jeśli bierzesz stąd mapę, bierzesz też ten obowiązek.

> © OpenStreetMap contributors · [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)
