# Warstwa graficzna — kontrakt

Dokument opisuje zasady, według których powstaje każdy sprite w Zagrodzie. Jest kontraktem,
nie inspiracją: sprite niezgodny z tymi metrykami nie wejdzie do gry, bo nie da się go
wstawić w siatkę ani pogodzić z resztą palety.

Powód istnienia tego pliku jest ten sam co skilli agenta — to wiedza, której model nie ma
skąd znać. Prompt bez metryk wygeneruje ładny obrazek i bezużyteczny asset.

## Siatka i skala

| | |
| --- | --- |
| kafel bazowy | **32 × 32 px** = **3 m** terenu |
| skala renderowania | do rozmiaru kafla na ekranie (32 px), `image-rendering: pixelated` |
| świat | 256 × 256 kafli = 768 m |
| widok przy 900 × 790 | ok. 28 × 24 kafli, czyli 84 × 74 m |
| obrót siatki | **13,93°** — zmierzony z osi ulic Starego Miasta |

Szesnaście pikseli to rozdzielczość konsoli 16-bitowej: wystarczająco dużo, żeby przedmiot
był rozpoznawalny, wystarczająco mało, żeby każdy piksel był decyzją. Skala musi być
całkowita — ×1.5 rozmazuje krawędzie i niszczy cały efekt.

## Proporcje — drabinka Pokémona

Kafel ma trzy metry, ale **człowiek zajmuje cały kafel**. To nie pomyłka, tylko
jedno świadome kłamstwo, na którym stoi cała ta estetyka: Pokémon ściska świat
*względem postaci*, żeby w kadrze mieściła się ulica z obiema pierzejami, a nie
pół elewacji. Gracz ma być bohaterem kadru, nie szpilką na planie.

| | w metrach | w kaflach |
| --- | --- | --- |
| **kafel** | **3 m** | 1 |
| człowiek | 1,5 m *(rysowany jak 3)* | **1** |
| drzewo | ok. 5 m | 1,5 |
| ulica | 6 m | 2 |
| kamienica (front) | 12–20 m | 4–6 |
| Rynek Wielki | ok. 100 m | ok. 33 |
| świat | 768 m | 256 |

Trzy reguły trzymają tę drabinkę:

- **Postać jest jedynym wyjątkiem.** Wszystko inne ma wymiar z mapy. Jeśli
  łapiesz się na powiększaniu kolejnej rzeczy „żeby było widać", to znak, że
  skala jest zła, a nie że ta rzecz jest wyjątkowa.
- **Kafel szerokości, półtora wzwyż.** Postać wystaje ponad swój kafel i o to
  chodzi — głowa to prawie połowa sylwetki.
- **Dachu więcej niż ściany.** Budynek, który ma jeden rząd dachu i dwa ściany,
  czyta się jak płot z oknami.

Historia tej tabeli jest ostrzeżeniem i warto ją tu zostawić. Pierwsza wersja
miała proporcje Animal Crossing przy kaflu 9 metrów — człowiek wychodził
wielkości kamienicy. Druga naprawiła metr kosztem proporcji i gra wyglądała jak
stare GTA. Trzecia skróciła kafel do półtora metra i pogodziła jedno z drugim,
ale kamienica zajmowała wtedy trzynaście kafli i w kadrze mieściła się połowa
jednej pierzei. Dopiero czwarta przestała udawać, że proporcje mają być
prawdziwe. **Rozmiar świata, wielkość postaci i zasięg kadru to jedna decyzja,
nie trzy** — i tylko ostatnia wersja podejmuje ją świadomie.

## Klasy sprite'ów

Wszystkie wymiary są wielokrotnościami 16. Kotwica „dół-środek" oznacza, że sprite stoi na
dolnej krawędzi swojego kafla i może wystawać w górę poza niego.

| klasa | wymiar | kotwica | kolorów + obrys | przykłady |
| --- | --- | --- | --- | --- |
| teren | 32 × 32 | — | 4, bez obrysu | bruk, rynek, trawa, ziemia, woda |
| dach kamienicy | 32 × 32 | — | 3 + obrys | osiem odcieni, po jednym na budynek |
| elewacja | 32 × 32 | — | 5 + obrys | tynk, okno, arkada podcienia, drzwi |
| mały obiekt | 32 × 32 | dół-środek | 4 + obrys | krzak, len, kamień, trzcina |
| drzewo | 48 × 48 | dół-środek | 5 + obrys | półtora kafla wzwyż, korona szersza niż pień |
| struktura stawiana | 32 × 40 | dół-środek | 5 + obrys | skrzynia, piec, warsztat |
| postać | 32 × 48 | dół-środek | 5 + obrys | kafel wszerz, półtora wzwyż, głowa blisko połowy |
| ikona ekwipunku | 32 × 32 | — | 4 + obrys | każdy przedmiot |

Przejść terenu **nie rysuje się sprite'ami**. Renderer składa je sam: każda warstwa
wie, na czym leży (trawa na ziemi, bruk na trawie, woda wprost na ziemi) i obrysowuje
się zaokrąglonym konturem. Dlatego brzeg jeziora robi piaszczysty pas bez jednego
pliku z kafelkiem brzegu.

Postacie dodatkowo: **4 kierunki × 3 klatki** (stoi, krok lewy, krok prawy) w jednym pliku
jako siatka 96 × 192.

## Paleta — 32 kolory, zamknięta

Każdy sprite używa wyłącznie tych wartości. Rampy mają po cztery stopnie: cień, baza,
światło, blik. Obrys bierze się ze stopnia „cień" własnej rampy, **nigdy z czerni**.

```
zieleń lasu     #1e3a1c  #2f5d2b  #3e7a3a  #5c9a4e
zieleń łąki     #4f7a3a  #6a9c4a  #7fb65c  #9ccd72
piasek          #8a7544  #b39a62  #e0cf9a  #f2e6bd
kamień          #3a3a3a  #6e6e6e  #8d8d8d  #b4b4b4
woda            #17395c  #22577f  #2a6fa8  #4a93c9
drewno          #4a3521  #6b4c2c  #9a6b3f  #c08f5a
rdza i żelazo   #4a2f24  #7a4a33  #9c6b4a  #c08a63
len i tkanina   #7a6b44  #9a8c6a  #c2a06a  #ddc794

akcenty         #c9a227 złoto   #ffcc55 ogień   #b4603a glina
                #d46a9f róż     #e8eef2 śnieg   #0f1410 noc
                #e7e2cf pergamin
```

Rampy nie są przypadkowe — wyprowadzone są z kolorów, które gra już ma w `game/content/`.
Dodanie nowej rampy to decyzja na poziomie tego dokumentu, nie pojedynczego sprite'a.

## Zasady rysunku

**Światło** — jedno źródło, z góry-lewej, pod 45°. Blik zawsze w górnej lewej krawędzi,
cień w dolnej prawej. Bez wyjątków, bo wyjątek widać natychmiast obok sąsiedniego kafla.

**Obrys** — 1 px, w kolorze „cień" z własnej rampy obiektu. Czysta czerń spłaszcza i robi
z grafiki naklejkę. Obiekty na terenie mają obrys pełny; sam teren nie ma go wcale.

**Cień rzucany** — elipsa szerokości obiektu, 2 px wysokości, przyklejona do dolnej
krawędzi, w kolorze terenu przyciemnionym o jeden stopień rampy. Bez przezroczystości —
krycie symuluje się szachownicą 1:1.

**Czego nie ma** — antyaliasingu, gradientów, rozmycia, półprzezroczystości. Kanał alfa ma
dwie wartości: 0 albo 255. Dithering wyłącznie szachownicą 1:1 i wyłącznie na przejściach
terenu oraz cieniach.

**Czytelność** — sprite musi być rozpoznawalny w skali 1:1, bez powiększania. Jeśli
przedmiot wymaga detalu, który ginie w 16 px, detal jest zły, nie rozdzielczość.

**Miękkość** — żadnego ostrego narożnika w sylwetce. Każdy obiekt ma zaokrąglone rogi,
nawet skrzynia i piec. To jedna zasada, która odróżnia świat przytulny od surowego,
i widać ją natychmiast, gdy któryś sprite ją łamie.

**Jasność** — w rampach sięgaj po dwa górne stopnie. Cień bierz ze stopnia „baza", nie
z „cienia" — ten zostaw na obrys. Świat ma być rozświetlony, nie kontrastowy.

## Nazewnictwo — grafika wiąże się z danymi

Nazwa pliku to **identyfikator z treści gry**. To nie konwencja porządkowa, tylko mechanizm:
renderer szuka pliku po `id`, a gdy go nie znajdzie, rysuje kolorowy prostokąt jak dziś.
Dzięki temu grafika może powstawać stopniowo i żaden brakujący sprite nie psuje gry.

```
game/assets/teren/<biome_id>.png          morze.png, laka.png
game/assets/surowce/<resource_id>.png     drzewo.png, krzak.png
game/assets/struktury/<structure_id>.png  warsztat.png, piec_hutniczy.png
game/assets/ikony/<item_id>.png           siekiera_kamienna.png
game/assets/postacie/<npc_id>.png         zofia.png
```

Gdy Bielik dodaje przedmiot, od razu wiadomo, jak nazywać jego ikonę. Gdy ikony nie ma,
widać to na pierwszy rzut oka w grze.

## Pipeline generowania

Modele obrazkowe nie potrafią narysować dokładnie 32 × 32. Potrafią za to narysować siatkę
32 × 32 **powiększoną**, w której każdy piksel jest wyraźnym kwadratem. Stąd trzy kroki:

1. **Generowanie** — prosisz o obraz 1024 × 1024 przedstawiający siatkę 32 × 32, gdzie każda
   komórka to jednolity kwadrat 32 × 32 px.
2. **Zmniejszenie** — nearest-neighbor dokładnie ×1/32. Wynik: prawdziwe 32 × 32.
3. **Kwantyzacja** — przypisanie każdego piksela do najbliższego koloru z palety powyżej
   i wyzerowanie alfy poniżej 50%.

Kroki 2 i 3 są deterministyczne i należą do skryptu, nie do oka. Bez nich paleta rozjedzie
się po trzydziestym spricie i nic tego nie posklei.

## Blok świata — obowiązkowy w każdym prompcie

Metryki pilnują, żeby sprite dało się wstawić w siatkę. **Blok świata pilnuje, żeby
należał do tej samej gry co pozostałe.**

> Źródłem prawdy o świecie jest [`LORE.md`](LORE.md) — ten sam plik, który trafia do
> każdego wywołania Bielika. Blok poniżej jest jego angielskim skrótem na potrzeby modeli
> obrazkowych. **Zmiana w lore pociąga zmianę tutaj**, inaczej teksty i grafika zaczną
> opisywać dwie różne wyspy. Bez niego model dostaje poprawne reguły
techniczne i zero pojęcia, czy trzcina rośnie nad Bałtykiem czy w tropikach — a wtedy
zgaduje, i każdy sprite zgaduje inaczej.

To ta sama lekcja co z `isNight()` w rdzeniu: czego nie zapiszesz, to model wymyśli.

```
WORLD — every sprite belongs to the same place; keep this consistent across all of them:
The Old Town of Zamość, a Renaissance fortress town on a regular plan: a pentagon of
earthen bastions, a great arcaded market square, tenement houses with ground-floor
arcades along a grid of narrow streets. Late summer. Everything is hand-made from what
the region gives: reed from the water, hay and flax from plots beyond the ramparts,
field stone, timber, charcoal, bog iron. Technology stops at hand tools.

STYLE — top-down tile world in the manner of a Game Boy Advance Pokémon town:
Crisp readable tiles, firm dark outlines, flat sunlit colour with one or two shading
steps — no gradients, no painterly blending. Buildings are compact boxes squarely on
the grid: a pitched roof mass with a lighter ridge, then a plastered front wall with
windows, arcades and a door. The world is deliberately compressed against the player:
one tile is 3 metres, yet a person fills a whole tile and stands half a tile taller.

NEVER include: fantasy creatures, magic glow, runes, crystals, neon, chrome, plastic,
modern objects, cars, weapons of war, skulls, anime faces, or tropical and East Asian
flora — no bamboo, no palms, no cherry blossom.

CONSISTENCY — this sprite will sit next to dozens of others on the same screen:
Same camera height and angle for every object. Same sun angle, from the upper left.
Everything except the player keeps its true size: a thing twice as wide in the world
is twice as wide here.
```

Lista „NEVER" nie jest przesadą. Modele obrazkowe mają silne skojarzenie
„pixel art + crafting" → japońskie RPG, i bez zakazu wstawią bambus, kwiat wiśni
albo świecący kryształ do kosza na trzcinę. Równie silne jest skojarzenie
„16-bit" → surowe, mroczne fantasy — a to dokładna odwrotność tego, czego chcemy.

## Prompt bazowy

Sloty: `{OPIS}`, `{SZEROKOSC}`, `{WYSOKOSC}`, `{KOLORY}`, `{PALETA}`.
Blok świata wkleja się **przed** `SUBJECT`.

```
Pixel art sprite for a top-down 2D survival and crafting game in the style of
16-bit console RPGs. Nostalgic, warm, hand-placed pixels — not a modern vector
illustration with a pixel filter.

WORLD — every sprite belongs to the same place; keep this consistent across all of them:
The Old Town of Zamość, a Renaissance fortress town on a regular plan: a pentagon of
earthen bastions, a great arcaded market square, tenement houses with ground-floor
arcades along a grid of narrow streets. Late summer. Everything is hand-made from what
the region gives: reed from the water, hay and flax from plots beyond the ramparts,
field stone, timber, charcoal, bog iron. Technology stops at hand tools.

STYLE — top-down tile world in the manner of a Game Boy Advance Pokémon town:
Crisp readable tiles, firm dark outlines, flat sunlit colour with one or two shading
steps — no gradients, no painterly blending. Buildings are compact boxes squarely on
the grid: a pitched roof mass with a lighter ridge, then a plastered front wall with
windows, arcades and a door. The world is deliberately compressed against the player:
one tile is 3 metres, yet a person fills a whole tile and stands half a tile taller.

NEVER include: fantasy creatures, magic glow, runes, crystals, neon, chrome, plastic,
modern objects, cars, weapons of war, skulls, anime faces, or tropical and East Asian
flora — no bamboo, no palms, no cherry blossom.

CONSISTENCY — this sprite will sit next to dozens of others on the same screen:
Same camera height and angle for every object. Same sun angle, from the upper left.
Everything except the player keeps its true size: a thing twice as wide in the world
is twice as wide here.

SUBJECT: {OPIS}

CANVAS AND GRID — follow exactly:
- The image is 512×512 and depicts a {SZEROKOSC}×{WYSOKOSC} pixel grid.
- Every grid cell is one flat square of a single solid colour, with hard edges.
- Cell boundaries align perfectly to the grid. No cell contains more than one colour.
- Background outside the subject is fully transparent.

DRAWING RULES — follow exactly:
- Maximum {KOLORY} colours for the subject, plus a 1-pixel outline.
- Outline is 1 cell thick, in a darker shade of the subject's own hue. Never black.
- One light source from the upper left at 45 degrees. Highlights on upper-left
  surfaces, shade on lower-right surfaces.
- No anti-aliasing, no gradients, no blur, no soft or glowing edges.
- Alpha is binary: a cell is either fully opaque or fully transparent.
- Orthographic top-down view tilted slightly toward the viewer, as in 16-bit
  action RPGs. The ground is flat; the object faces the camera.
- The subject is centred horizontally and stands on the bottom edge of the canvas.
- No text, no numbers, no logo, no frame, no border, no background scenery,
  no drop shadow outside the subject.

PALETTE — use only these colours, nothing in between:
{PALETA}
```

## Warianty per klasa

Do `{OPIS}` dokleja się zdanie właściwe dla klasy:

- **teren** — `The tile must tile seamlessly in all four directions: the left edge continues into the right edge, the top into the bottom. No outline, no single focal point, even visual density across the whole tile.`
- **mały obiekt** — `The object occupies roughly the central two thirds of the canvas, leaving the outer cells transparent. A two-cell-tall elliptical shadow sits under it.`
- **wysoki obiekt** — `The object fills the lower half and rises into the upper half. Its base is no wider than ten cells so neighbouring tiles stay readable.`
- **ikona ekwipunku** — `Single object on a fully transparent background, no shadow, no ground. Rendered at a three-quarter angle so its silhouette is instantly recognisable at actual size.`
- **postać** — `Front-facing standing pose, arms at the sides. Head occupies the top third. The silhouette must read clearly at actual size.`

## Przykład wypełniony

Dla `kosz_wiklinowy` (ikona ekwipunku, 32 × 32):

```
SUBJECT: A woven wicker basket made of dried reed, tall and roomy, with a visible
over-under weave pattern on its body and a slightly flared rim. Single object on a
fully transparent background, no shadow, no ground. Rendered at a three-quarter
angle so its silhouette is instantly recognisable at actual size.

CANVAS AND GRID: 16×16 grid, 4 colours plus outline.

PALETTE — use only these colours:
#7a6b44 #9a8c6a #c2a06a #ddc794 #4a3521
```

Cztery stopnie rampy „len i tkanina" plus obrys z rampy drewna. Kosz utka się sam.
