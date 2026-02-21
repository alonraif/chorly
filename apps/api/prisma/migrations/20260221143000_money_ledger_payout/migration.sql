BEGIN;
CREATE TYPE "MoneyLedgerType_new" AS ENUM ('earn', 'payout');
ALTER TABLE "MoneyLedger" ALTER COLUMN "type" TYPE "MoneyLedgerType_new" USING ("type"::text::"MoneyLedgerType_new");
ALTER TYPE "MoneyLedgerType" RENAME TO "MoneyLedgerType_old";
ALTER TYPE "MoneyLedgerType_new" RENAME TO "MoneyLedgerType";
DROP TYPE "MoneyLedgerType_old";
COMMIT;
