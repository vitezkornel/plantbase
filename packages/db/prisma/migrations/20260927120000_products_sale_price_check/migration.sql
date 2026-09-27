-- Domain rule (docs/ddd/model.md "Akciós termék"): a product is on sale only
-- if sale_price < price. Enforced here, once, for every write path (seed,
-- product-sync skill, ingest agent). Prisma's schema cannot express CHECK
-- constraints, so this lives only in this hand-written migration.
ALTER TABLE "products" ADD CONSTRAINT "products_sale_price_lt_price"
  CHECK ("sale_price" IS NULL OR ("price" IS NOT NULL AND "sale_price" < "price"));
