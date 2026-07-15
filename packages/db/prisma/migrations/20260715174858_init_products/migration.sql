-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "latin_name" TEXT,
    "category" TEXT,
    "location" TEXT,
    "price" DECIMAL(65,30),
    "sale_price" DECIMAL(65,30),
    "stock" INTEGER,
    "light" TEXT,
    "watering" TEXT,
    "difficulty" TEXT,
    "current_height_cm" INTEGER,
    "max_height_cm" INTEGER,
    "current_pot_cm" INTEGER,
    "pet_safe" BOOLEAN,
    "kid_safe" BOOLEAN,
    "air_purifying" BOOLEAN,
    "rating" DECIMAL(65,30),
    "reviews_count" INTEGER,
    "description" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
