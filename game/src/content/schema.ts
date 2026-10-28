import { z } from 'zod';

/**
 * Pojedyncze źródło prawdy o kształcie treści gry.
 *
 * Ten plik jest NIEZAPISYWALNY dla agenta (patrz agent/src/config.ts → WRITE_DENY).
 * Granice liczbowe nie są kosmetyką: to one uniemożliwiają modelowi
 * "naprawienie" nieprzechodzącego testu przez wyprodukowanie godmode'owego itemu.
 */

export const Id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,31}$/, 'id: małe litery, cyfry i _, 2-32 znaki');
export const PlName = z.string().min(2).max(40);
export const Desc = z.string().max(200);
export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'kolor: #rrggbb');
const Unit = z.number().min(0).max(1);
const Range01 = z
  .tuple([Unit, Unit])
  .refine(([a, b]) => a < b, 'zakres: pierwsza wartość musi być mniejsza');

export const TOOL_KINDS = ['hand', 'axe', 'pickaxe', 'hoe', 'rod', 'scythe'] as const;
/**
 * Słownik tagów jest ZAMKNIĘTY i to nie jest przesada.
 *
 * Dopóki tag był dowolnym identyfikatorem, model dopisał przedmiotowi tag "narzucie"
 * i nic tego nie złapało — ani schemat, ani walidator, ani testy. Enum robi dwie rzeczy
 * naraz: bramka łapie literówkę, a gramatyka dekodowania sprawia, że model fizycznie nie
 * może jej wypisać. Przedmiot bez pasującego tagu zostawia pustą listę; to jest poprawna
 * odpowiedź, a wymyślanie nowego słowa nie jest.
 */
export const TAGS = [
  'surowiec', 'polprodukt', 'narzedzie', 'jedzenie', 'paliwo', 'budynek', 'schowek', 'swiatlo',
] as const;
export const STATIONS = ['hand', 'workbench', 'furnace', 'kitchen', 'loom'] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];
export type Station = (typeof STATIONS)[number];
export type Tag = (typeof TAGS)[number];

export const ItemSchema = z
  .object({
    id: Id,
    name: PlName,
    desc: Desc.default(''),
    tags: z.array(z.enum(TAGS)).max(8).default([]),
    stack: z.number().int().min(1).max(999).default(99),
    /** Wartość handlowa — używana przez kontrolę ekonomii (bez pętli nieskończonego zysku). */
    value: z.number().int().min(1).max(10000).default(1),
    tool: z
      .object({
        // "hand" oznacza BRAK narzędzia, więc żaden przedmiot nie może być narzędziem ręcznym.
        kind: z.enum(TOOL_KINDS).refine((k) => k !== 'hand', '"hand" to brak narzędzia, nie rodzaj narzędzia'),
        power: z.number().int().min(1).max(5),
        durability: z.number().int().min(10).max(5000),
      })
      .strict()
      .optional(),
    edible: z
      .object({ energy: z.number().int().min(1).max(60) })
      .strict()
      .optional(),
    placeable: z.object({ structure: Id }).strict().optional(),
  })
  .strict();

export const StructureSchema = z
  .object({
    id: Id,
    name: PlName,
    desc: Desc.default(''),
    color: Hex,
    blocks: z.boolean().default(true),
    // "hand" to brak stanowiska, więc struktura nie może go dawać — tak samo jak
    // żaden przedmiot nie jest narzędziem rodzaju "hand".
    station: z.enum(STATIONS).refine((s) => s !== 'hand', '"hand" to brak stanowiska, nie rodzaj stanowiska').optional(),
    storage: z.number().int().min(0).max(200).default(0),
  })
  .strict();

/**
 * Zwieńczenie kamienicy. Attyka jest znakiem firmowym Zamościa — ozdobna ścianka
 * nad gzymsem, od prostej geometrii po płaskorzeźbę. "brak" to dach bez niej.
 */
export const ATTYKI = ['brak', 'prosta', 'rzezbiona'] as const;
export type Attyka = (typeof ATTYKI)[number];

/**
 * Archetyp fasady — typologia, nie konkretny budynek.
 *
 * Podział pracy jest tu celowy i wynika z pomiaru. Bielik zapytany o konkretne
 * kamienice Rynku Wielkiego konfabuluje: wymienia tę samą "Pod Małpą" dwa razy jako
 * dwa różne budynki i dorysowuje dachy mansardowe miastu, które słynie z attyk.
 * Zapytany ogólnie, po czym poznać kamienicę z Zamościa, odpowiada poprawnie — i co
 * ważniejsze, każda wymieniona przez niego cecha jest parametrem, nie opisem.
 *
 * Dlatego tożsamość budynku bierze się z OSM (liczba kondygnacji, status zabytku),
 * a stąd bierze się tylko to, JAK wygląda budynek danego rodzaju. Nikt nie zgaduje,
 * co stoi pod którym adresem.
 */
export const FacadeSchema = z
  .object({
    id: Id,
    name: PlName,
    desc: Desc.default(''),
    /** Kolor tynku. Zamojskie pierzeje są pastelowe i w tym się między sobą różnią. */
    plaster: Hex,
    /** Kolor dachówki. Odcień pojedynczego budynku dokłada do tego wariację. */
    roof: Hex,
    attic: z.enum(ATTYKI).default('brak'),
    /**
     * Co ile kafli arkada podcienia; 0 oznacza fasadę bez podcieni. Przy trzech
     * metrach na kafel 2 daje przęsło sześciometrowe, czyli mniej więcej tyle,
     * ile mają prawdziwe zamojskie podcienia.
     */
    arcades: z.number().int().min(0).max(4),
    /**
     * Zakres kondygnacji z OSM, do którego ten archetyp pasuje, włącznie.
     * Zero znaczy "OSM nie podaje" — a tego nie wolno udawać, że wiemy.
     */
    storeys: z.tuple([z.number().int().min(0).max(6), z.number().int().min(0).max(6)])
      .refine(([a, b]) => a <= b, 'zakres kondygnacji: pierwsza wartość nie może być większa'),
    /** Czy archetyp jest dla budynków oznaczonych w OSM jako zabytek. */
    heritage: z.boolean().default(false),
  })
  .strict();

export const DropSchema = z
  .object({
    item: Id,
    min: z.number().int().min(1).max(20),
    max: z.number().int().min(1).max(20),
    chance: z.number().min(0.01).max(1).default(1),
  })
  .strict()
  .refine((d) => d.min <= d.max, 'drop: min > max');

export const ResourceSchema = z
  .object({
    id: Id,
    name: PlName,
    desc: Desc.default(''),
    color: Hex,
    biomes: z.array(Id).min(1).max(8),
    /** Udział kafli biomu zajętych przez ten surowiec. */
    density: z.number().min(0.001).max(0.25),
    hp: z.number().int().min(1).max(20),
    tool: z.enum(TOOL_KINDS),
    blocks: z.boolean().default(true),
    drops: z.array(DropSchema).min(1).max(4),
    /** 0 = nie odrasta. */
    regrow: z.number().int().min(0).max(20000).default(0),
  })
  .strict();

export const RecipeSchema = z
  .object({
    id: Id,
    name: PlName,
    station: z.enum(STATIONS),
    inputs: z
      .array(z.object({ item: Id, qty: z.number().int().min(1).max(20) }).strict())
      .min(1)
      .max(4),
    output: z.object({ item: Id, qty: z.number().int().min(1).max(20) }).strict(),
    ticks: z.number().int().min(1).max(600).default(1),
  })
  .strict();

export const BiomeSchema = z
  .object({
    id: Id,
    name: PlName,
    color: Hex,
    walkable: z.boolean(),
    /** Prostokąt w przestrzeni (wysokość, wilgotność). Suma biomów musi pokryć cały kwadrat. */
    elevation: Range01,
    moisture: Range01,
    /** Wyższy priorytet wygrywa przy nałożeniu zakresów. */
    priority: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export const NpcSchema = z
  .object({
    id: Id,
    name: PlName,
    color: Hex,
    home: z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict(),
    /**
     * Co ta postać może komuś dać podczas rozmowy — i NIC poza tym.
     *
     * Ta lista jest całym słownikiem akcji dla żywego dialogu: gramatyka dekodowania
     * powstaje z niej, więc model fizycznie nie wypisze daru spoza niej, a rdzeń i tak
     * sprawdza ją drugi raz. Drobiazgi, nie wyprawka: kontrola NPC_DAR pilnuje, żeby
     * nie dało się obejść progresji przez rozdawanie narzędzi.
     */
    gives: z.array(Id).max(4).default([]),
    /** Kim ta osoba jest, jednym zdaniem. Trafia do promptu rozmowy i do okna w grze. */
    opis: Desc.default(''),
    /**
     * Co ta osoba wie o okolicy — zdania, których modelowi NIE WOLNO wymyślać.
     *
     * Rozdział jest ten sam, co przy fasadach: fakty pochodzą z zapisu, a model daje
     * im głos. Bielik zapytany wprost o kamienice Rynku Wielkiego wymienił tę samą
     * „Pod Małpą" dwa razy jako dwa różne domy i połączył prawdziwą Kamienicę
     * Wilczkowską z prawdziwą Pod Aniołem w jeden budynek. Nazwy zabytków biorą się
     * więc z mapy, a to, co o nich wiadomo — stąd.
     */
    wiedza: z.array(z.string().min(10).max(300)).max(12).default([]),
    likes: z.array(Id).max(5).default([]),
    dialogues: z.array(z.string().min(3).max(200)).min(1).max(12),
  })
  .strict();

export const ConfigSchema = z
  .object({
    worldSize: z.number().int().min(32).max(512),
    seed: z.number().int().min(0),
    dayTicks: z.number().int().min(200).max(100000),
    energyMax: z.number().int().min(10).max(500),
    energyPerAction: z.number().int().min(0).max(20),
    startInventory: z.array(
      z.object({ item: Id, qty: z.number().int().min(1).max(99) }).strict(),
    ),
    npcDensityCheck: z.boolean().default(true),
  })
  .strict();

export const ContentSchema = z
  .object({
    config: ConfigSchema,
    items: z.array(ItemSchema).min(1),
    structures: z.array(StructureSchema).min(1),
    resources: z.array(ResourceSchema).min(1),
    recipes: z.array(RecipeSchema).min(1),
    biomes: z.array(BiomeSchema).min(2),
    facades: z.array(FacadeSchema).min(1),
    npcs: z.array(NpcSchema),
  })
  .strict();

export type Item = z.infer<typeof ItemSchema>;
export type Structure = z.infer<typeof StructureSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Biome = z.infer<typeof BiomeSchema>;
export type Facade = z.infer<typeof FacadeSchema>;
export type Npc = z.infer<typeof NpcSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type Content = z.infer<typeof ContentSchema>;
