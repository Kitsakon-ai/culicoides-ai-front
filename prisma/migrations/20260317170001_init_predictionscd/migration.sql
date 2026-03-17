-- CreateTable
CREATE TABLE `predictions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `filename` VARCHAR(255) NULL,
    `species` VARCHAR(100) NOT NULL,
    `genus` VARCHAR(100) NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `confidenceLevel` VARCHAR(50) NOT NULL,
    `gradcam` BOOLEAN NOT NULL DEFAULT false,
    `modelUsed` VARCHAR(100) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
