-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "region" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "verifications" (
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surface" TEXT NOT NULL,
    "judgment" TEXT NOT NULL,
    "errorKind" TEXT,
    "band" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "alerted" BOOLEAN NOT NULL,
    "corroborated" BOOLEAN NOT NULL,
    "scanSource" TEXT NOT NULL,
    "lexiconIds" TEXT[],
    "combos" TEXT[],
    "dampened" TEXT[],
    "localScore" INTEGER NOT NULL,
    "llmScore" INTEGER,
    "injectionHits" TEXT[],
    "drivers" JSONB NOT NULL,
    "note" TEXT,
    "content" TEXT,
    "region" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "lexiconVersion" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "sessions_accountId_idx" ON "sessions"("accountId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "verifications_accountId_idx" ON "verifications"("accountId");

-- CreateIndex
CREATE INDEX "reports_accountId_idx" ON "reports"("accountId");

-- CreateIndex
CREATE INDEX "reports_errorKind_lexiconVersion_idx" ON "reports"("errorKind", "lexiconVersion");

-- CreateIndex
CREATE INDEX "reports_reviewedAt_idx" ON "reports"("reviewedAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
