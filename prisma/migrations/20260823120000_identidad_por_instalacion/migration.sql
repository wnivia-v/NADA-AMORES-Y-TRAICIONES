-- Identidad por instalacion: fuera las cuentas con correo.
--
-- ADVERTENCIA: DROP COLUMN accountId y DROP TABLE accounts destruyen datos.
-- En una base con reportes ya guardados hay que decidir antes que pasa con
-- ellos: se quedan huerfanos sin identidad util. Aqui se asume desarrollo.

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_accountId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_accountId_fkey";

-- DropForeignKey
ALTER TABLE "verifications" DROP CONSTRAINT "verifications_accountId_fkey";

-- DropIndex
DROP INDEX "reports_accountId_idx";

-- AlterTable
ALTER TABLE "reports" DROP COLUMN "accountId",
ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "installId" TEXT NOT NULL,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "os" TEXT,
ADD COLUMN     "platform" TEXT;

-- DropTable
DROP TABLE "accounts";

-- DropTable
DROP TABLE "sessions";

-- DropTable
DROP TABLE "verifications";

-- CreateIndex
CREATE INDEX "reports_installId_idx" ON "reports"("installId");

-- CreateIndex
CREATE INDEX "reports_ip_idx" ON "reports"("ip");

