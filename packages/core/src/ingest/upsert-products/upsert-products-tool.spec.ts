import { describe, expect, it, vi } from 'vitest';
import { executeUpsertProducts } from './upsert-products-tool.js';

const product = {
  source: 'tropicalhome.hu',
  handle: 'ficus-lyrata-9cm',
  name: 'Lantlevelű fikusz',
  latinName: 'Ficus lyrata',
  category: 'szobanövény',
  location: 'beltéri',
  priceHuf: 4000,
  salePriceHuf: 3000,
  available: true,
  light: 'erős',
  watering: null,
  difficulty: null,
  maxHeightCm: null,
  currentPotCm: 9,
  petSafe: null,
  airPurifying: true,
  description: 'Hegedű alakú levelű, világos helyet kedvelő szobanövény.',
};

function writer() {
  return vi.fn(async (rows: { sourceHandle: string }[]) => ({
    inserted: rows.map((r) => r.sourceHandle),
    updated: [],
  }));
}

describe('executeUpsertProducts', () => {
  it('should map to the Product schema (available → stock 1, kidSafe/currentHeight null) and call the writer', async () => {
    const write = writer();

    const outcome = await executeUpsertProducts(
      { products: [product] },
      { writer: write },
    );

    expect(outcome).toEqual({
      ok: true,
      data: {
        inserted: ['ficus-lyrata-9cm'],
        updated: [],
        rejected: [],
        warnings: [],
      },
    });
    expect(write).toHaveBeenCalledWith([
      expect.objectContaining({
        source: 'tropicalhome.hu',
        sourceHandle: 'ficus-lyrata-9cm',
        price: 4000,
        salePrice: 3000,
        stock: 1,
        kidSafe: null,
        currentHeightCm: null,
      }),
    ]);
  });

  it('should enforce sale_price < price: a non-lower sale price becomes null with a warning', async () => {
    const write = writer();

    const outcome = await executeUpsertProducts(
      { products: [{ ...product, salePriceHuf: 4000, available: false }] },
      { writer: write },
    );

    expect(write.mock.calls[0][0][0]).toMatchObject({
      salePrice: null,
      stock: 0,
    });
    expect(
      (outcome as { data: { warnings: string[] } }).data.warnings,
    ).toHaveLength(1);
  });

  it('should refuse bundle-looking rows without writing them', async () => {
    const write = writer();

    const outcome = await executeUpsertProducts(
      {
        products: [
          {
            ...product,
            handle: 'hoya-csomag-kezdoknek',
            name: 'Hoya csomag kezdőknek',
          },
        ],
      },
      { writer: write },
    );

    expect(write).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      ok: true,
      data: { inserted: [], rejected: [expect.stringContaining('csomag')] },
    });
  });

  it.each([
    ['an out-of-set category', { category: 'fikusz' }],
    ['a petSafe of false (absence must be null)', { petSafe: false }],
    ['an unknown source', { source: 'example.com' }],
  ])('should reject %s before touching the DB', async (_label, override) => {
    const write = writer();

    const outcome = await executeUpsertProducts(
      { products: [{ ...product, ...override }] },
      { writer: write },
    );

    expect(outcome.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('should return an error outcome (not throw) when the DB write fails', async () => {
    const write = vi.fn().mockRejectedValue(new Error('connection refused'));

    const outcome = await executeUpsertProducts(
      { products: [product] },
      { writer: write },
    );

    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining('connection refused'),
    });
  });
});
