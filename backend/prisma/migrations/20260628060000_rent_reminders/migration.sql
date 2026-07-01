-- Track which rent-reminder windows have already fired per invoice, so the
-- rent-billing sweep never sends the same window (5-day / 1-day) twice.
ALTER TABLE "rent_invoices" ADD COLUMN "remindersSent" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
