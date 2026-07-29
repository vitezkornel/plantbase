-- Prisma cannot diff changes to an `Unsupported(...)` column's raw type
-- string (confirmed: `prisma migrate dev` reported "Already in sync" after
-- the schema.prisma edit from vector(1024) to vector(1536)) — written and
-- applied by hand, then recorded via `prisma migrate resolve --applied`.
--
-- Widened from 1024 to 1536: Cohere embed-v4.0's default float embedding
-- dimension (no dimension-override parameter exists in the installed
-- cohere-ai SDK's EmbedRequest type) is assumed 1536, not yet confirmed
-- against a real API response — verify before the R4 full ingest run.
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1536);
