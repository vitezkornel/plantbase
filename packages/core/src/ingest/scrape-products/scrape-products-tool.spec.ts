import { describe, expect, it, vi } from 'vitest';
import {
  executeScrapeProducts,
  normalizeProduct,
} from './scrape-products-tool.js';

const ficus = {
  handle: 'ficus-lyrata-9cm',
  title: 'Ficus lyrata 9cm - Lantlevelű fikusz',
  product_type: 'Ficus',
  tags: ['9 cm', 'Világos helyre', 'rs_AK', 'Channel: Online'],
  body_html: '<p>Hegedű alakú <b>levelek</b>.</p>',
  variants: [
    { price: '3000.00', compare_at_price: '4000.00', available: true },
    { price: '2500.00', compare_at_price: null, available: false },
  ],
};
const pack = {
  handle: 'fun-ficus-party-pack',
  title: 'Fun Ficus Party Pack',
  product_type: 'Indoor Plant',
  tags: [],
  body_html: '',
  variants: [{ price: '100.00', compare_at_price: null, available: true }],
};
const pot = {
  handle: 'terracotta-pot',
  title: 'Terracotta kaspó',
  product_type: 'Kaspók',
  tags: [],
  body_html: '',
  variants: [{ price: '1500.00', compare_at_price: null, available: true }],
};

function feed(pages: unknown[][]) {
  return vi.fn(async (url: string) => {
    const page = Number(new URL(url).searchParams.get('page'));
    return { products: pages[page - 1] ?? [] };
  });
}

describe('normalizeProduct', () => {
  it('should take the cheapest available variant and treat compare_at_price > price as a sale', () => {
    const item = normalizeProduct(ficus, 'tropicalhome.hu');
    expect(item).toMatchObject({
      priceHuf: 4000,
      salePriceHuf: 3000,
      available: true,
      bundleHint: null,
    });
  });

  it('should drop marketing/ops tags and strip HTML from the excerpt', () => {
    const item = normalizeProduct(ficus, 'tropicalhome.hu');
    expect(item.tags).toEqual(['9 cm', 'Világos helyre']);
    expect(item.excerpt).toBe('Hegedű alakú levelek .');
  });

  it('should keep fact tags (light, pet, size…) when capping a long tag list', () => {
    const filler = Array.from({ length: 20 }, (_, i) => `promo-${i}`);
    const item = normalizeProduct(
      {
        ...ficus,
        tags: [...filler, 'Sunlight Value: Full Sun', 'pet-friendly'],
      },
      'thesill.com',
    );
    expect(item.tags).toHaveLength(15);
    expect(item.tags.slice(0, 2)).toEqual([
      'Sunlight Value: Full Sun',
      'pet-friendly',
    ]);
  });

  it('should convert USD feed prices to HUF at the fixed rate, rounded to 10 Ft', () => {
    const item = normalizeProduct(
      {
        ...ficus,
        variants: [{ price: '12.99', compare_at_price: null, available: true }],
      },
      'thesill.com',
    );
    expect(item.priceHuf).toBe(4550);
  });

  it('should flag bundle-looking items', () => {
    expect(normalizeProduct(pack, 'thesill.com').bundleHint).toContain('Pack');
  });
});

describe('executeScrapeProducts', () => {
  it('should read every page, pre-filter by regex and report counts', async () => {
    const fetchJson = feed([[ficus, pot], [pack]]);

    const outcome = await executeScrapeProducts(
      { source: 'tropicalhome.hu', match: 'fikusz|ficus' },
      { fetchJson },
    );

    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(outcome.ok).toBe(true);
    const data = (
      outcome as {
        data: {
          totalInFeed: number;
          matched: number;
          items: { handle: string }[];
        };
      }
    ).data;
    expect(data.totalInFeed).toBe(3);
    expect(data.matched).toBe(2);
    expect(data.items.map((i) => i.handle)).toEqual([
      'ficus-lyrata-9cm',
      'fun-ficus-party-pack',
    ]);
  });

  it('should cap the extract at the requested limit and say it was truncated', async () => {
    const outcome = await executeScrapeProducts(
      { source: 'tropicalhome.hu', limit: 1 },
      { fetchJson: feed([[ficus, pot, pack]]) },
    );
    expect(outcome).toMatchObject({
      ok: true,
      data: { matched: 3, truncated: true },
    });
    expect((outcome as { data: { items: unknown[] } }).data.items).toHaveLength(
      1,
    );
  });

  it('should return an error outcome (not throw) for an invalid regex', async () => {
    const outcome = await executeScrapeProducts(
      { source: 'thesill.com', match: '(' },
      { fetchJson: feed([]) },
    );
    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining('reguláris'),
    });
  });

  it('should return an error outcome for an unknown source', async () => {
    const outcome = await executeScrapeProducts(
      { source: 'example.com' },
      { fetchJson: feed([]) },
    );
    expect(outcome.ok).toBe(false);
  });

  it('should return an error outcome when the feed request fails', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('HTTP 503'));
    const outcome = await executeScrapeProducts(
      { source: 'thesill.com' },
      { fetchJson },
    );
    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining('HTTP 503'),
    });
  });
});
