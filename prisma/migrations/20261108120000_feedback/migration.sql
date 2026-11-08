-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'FEATURE', 'IMPROVEMENT', 'UX', 'GENERAL');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'TRIAGED', 'PLANNED', 'IN_PROGRESS', 'DONE', 'DECLINED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "FeedbackSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "FeedbackPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "route" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "severity" "FeedbackSeverity",
    "priority" "FeedbackPriority",
    "duplicateOfId" TEXT,
    "decisionNote" TEXT,
    "taskLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

