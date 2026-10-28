# Dane mapy — OpenStreetMap, ODbL

Licencja MIT w pliku `LICENSE` obejmuje **kod**. Nie obejmuje danych mapy.

`game/content/mapa.json` jest **bazą pochodną** wykonaną z OpenStreetMap:
kafle terenu, odcienie dachów, liczba kondygnacji, status zabytku i nazwy
58 obiektów historycznych. Podlega **Open Database License (ODbL) 1.0** —
razem ze wszystkim, co z tej bazy powstaje, w tym częścią `game/dowody.json`
opisującą świat.

> © OpenStreetMap contributors
> <https://www.openstreetmap.org/copyright>
> ODbL 1.0 — <https://opendatacommons.org/licenses/odbl/1-0/>

Kto bierze stąd mapę, bierze też ten obowiązek: trzeba zachować atrybucję
i udostępnić bazę pochodną na tej samej licencji.

Mapę odtwarza `tools/import-osm.ts` z odpowiedzi Overpass API — plik nie jest
ręcznie redagowany i każda zmiana świata przechodzi przez ten import.
