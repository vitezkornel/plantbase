// packages/core/src/ingest/upsert-products/upsert-products-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": this is the one tool that
// WRITES, so its model-produced input is validated strictly — the value
// sets are the ones in docs/ddd/glossary.md (and schema.prisma comments).

import { z } from 'zod';
import { FEED_SOURCES } from '../scrape-products/scrape-products-schema.js';

const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable();

export const CATEGORIES = [
  'szobanövény',
  'kerti',
  'pozsgás',
  'kaktusz',
  'fűszer',
  'fa-cserje',
  'lógó',
  'virágzó',
] as const;
export const LOCATIONS = ['beltéri', 'kültéri', 'mindkettő'] as const;
export const LIGHTS = [
  'árnyék',
  'alacsony',
  'közepes',
  'erős',
  'direkt nap',
] as const;
export const WATERINGS = [
  'ritka',
  'közepes',
  'gyakori',
  'állandóan nedves',
] as const;
export const DIFFICULTIES = ['kezdő', 'haladó', 'profi'] as const;

const priceHuf = z.number().int().nonnegative().nullable();
const cm = z.number().int().positive().nullable();

export const IngestProductSchema = z.object({
  source: z.enum(FEED_SOURCES),
  handle: z
    .string()
    .min(1)
    .describe('A feedbeli handle, pontosan ahogy a scrapeProducts visszaadta.'),
  name: z.string().min(1),
  latinName: z.string().nullable(),
  category: nullableEnum(CATEGORIES),
  location: nullableEnum(LOCATIONS),
  priceHuf,
  salePriceHuf: priceHuf,
  available: z.boolean(),
  light: nullableEnum(LIGHTS),
  watering: nullableEnum(WATERINGS),
  difficulty: nullableEnum(DIFFICULTIES),
  maxHeightCm: cm,
  currentPotCm: cm,
  petSafe: z
    .literal(true)
    .nullable()
    .describe('Csak true (explicit címke) vagy null — soha nem false.'),
  airPurifying: z.literal(true).nullable(),
  description: z
    .string()
    .min(1)
    .max(1200)
    .describe('2–4 mondatos, saját szavas magyar leírás.'),
});

export const UpsertProductsInputSchema = z.object({
  products: z.array(IngestProductSchema).min(1).max(60),
});

export type IngestProduct = z.infer<typeof IngestProductSchema>;
export type UpsertProductsInput = z.infer<typeof UpsertProductsInputSchema>;
