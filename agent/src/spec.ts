import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  BiomeSchema,
  ConfigSchema,
  Id,
  ItemSchema,
  NpcSchema,
  RecipeSchema,
  ResourceSchema,
  STATIONS,
  StructureSchema,
  TOOL_KINDS,
} from '../../game/src/content/schema.js';

/**
 * ChangeSpec — kontrakt między modelem a repozytorium.
 *
 * Kluczowa decyzja projektowa: dla zmian w danych model NIE pisze plików. Model emituje
 * deklaratywne operacje, a stosuje je deterministyczny kod (stages/applyData.ts).
 * Dzięki temu najczęstsza klasa zmian jest bezpieczna nawet przy słabym modelu —
 * najgorsze, co może się stać, to odrzucenie spec przez schemat albo przez bramkę.
 *
 * Druga decyzja: schemat jest WĄSKI. Najpierw jedno tanie zapytanie wybiera kolekcje,
 * dopiero potem budujemy schemat operacji wyłącznie dla nich. Model 11B radzi sobie
 * z gramatyką na trzy pola; z unią trzynastu operacji już nie.
 */

export const COLLECTIONS = ['items', 'recipes', 'resources', 'structures', 'npcs', 'biomes', 'config'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const RouteSchema = z
  .object({
    kind: z.enum(['dane', 'kod']),
    collections: z.array(z.enum(COLLECTIONS)).max(5),
    title: z.string().min(3).max(70),
    summary_pl: z.string().min(10).max(500),
    code_request_en: z.string().max(1500),
    /** Czy zmiana naprawdę wymaga skasowania istniejących wpisów. */
    removes_content: z.boolean(),
    /** Czy zmiana dotyka istniejących wpisów, czy tylko dodaje nowe. */
    modifies_existing: z.boolean(),
  })
  .strict();

export type Route = z.infer<typeof RouteSchema>;

const DEFS = {
  items: ItemSchema,
  recipes: RecipeSchema,
  resources: ResourceSchema,
  structures: StructureSchema,
  npcs: NpcSchema,
  biomes: BiomeSchema,
} satisfies Record<Exclude<Collection, 'config'>, z.ZodObject<z.ZodRawShape>>;

export type OpsSpec = {
  remove?: Array<{ collection: Collection; id: string }>;
  patch_config?: Record<string, unknown>;
} & Record<string, unknown>;

/** Schemat operacji zawężony do kolekcji wskazanych w fazie routingu. */
export function buildOpsSchema(
  cols: Collection[],
  allowRemove = false,
  allowPatch = false,
): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  for (const c of cols) {
    if (c === 'config') {
      if (allowPatch) shape.patch_config = ConfigSchema.partial();
      continue;
    }
    const def = DEFS[c];
    shape[`add_${c}`] = z.array(def).max(8);
    // Gałęzie patch_* podwajają rozmiar gramatyki, a model 11B dekoduje pod gramatyką
    // tym wolniej, im jest ona większa. Dokładamy je tylko wtedy, gdy zmiana naprawdę
    // dotyka istniejących wpisów.
    if (allowPatch) {
      shape[`patch_${c}`] = z.array(z.object({ id: Id, patch: def.partial() }).strict()).max(8);
    }
  }
  // Kasowanie jest poza schematem, dopóki routing go wyraźnie nie zażąda. Model, który nie
  // ma jak usunąć wpisu, nie usunie go przez przypadek — a to był realny tryb awarii.
  if (allowRemove) {
    shape.remove = z.array(z.object({ collection: z.enum(COLLECTIONS), id: Id }).strict()).max(4);
  }
  return z.object(shape).strict();
}

/** Jeden JSON Schema dla dwóch konsumentów: gramatyki Ollamy i promptu API. */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
}

export const VOCAB = {
  tools: [...TOOL_KINDS],
  stations: [...STATIONS],
};
