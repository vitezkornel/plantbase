-- AlterTable
ALTER TABLE "products" ADD COLUMN     "source" TEXT,
ADD COLUMN     "source_handle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_source_source_handle_key" ON "products"("source", "source_handle");

