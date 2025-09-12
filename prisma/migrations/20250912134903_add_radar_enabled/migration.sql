-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Insult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blamerId" TEXT NOT NULL,
    "insult" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Insult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Insult_blamerId_fkey" FOREIGN KEY ("blamerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setup" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "leaderboardMessageId" TEXT NOT NULL,
    "radarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Insult_guildId_userId_idx" ON "Insult"("guildId", "userId");

-- CreateIndex
CREATE INDEX "Insult_guildId_blamerId_idx" ON "Insult"("guildId", "blamerId");

-- CreateIndex
CREATE INDEX "Setup_channelId_idx" ON "Setup"("channelId");
