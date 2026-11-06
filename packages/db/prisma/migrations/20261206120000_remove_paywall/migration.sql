DROP TRIGGER IF EXISTS usage_audit_write ON usage_records;
DROP TRIGGER IF EXISTS usage_audit_revision ON usage_records;
ALTER TABLE usage_records DROP COLUMN "auditRevision";

DROP TABLE billing_audit_events;
DROP TABLE model_credit_lots;
DROP TABLE model_credit_entries;
DROP TABLE model_credit_accounts;
DROP TABLE billing_accounts;
DROP TABLE referrals;
DROP TABLE referral_codes;
DROP TABLE access_grants;
DROP TABLE computer_runs;
DROP TABLE home_deletion_notices;

DROP FUNCTION billing_audit_immutable();
DROP FUNCTION billing_audit_revision();
DROP FUNCTION billing_audit_credit();
DROP FUNCTION billing_audit_usage();
DROP FUNCTION billing_audit_account_closed();
DROP FUNCTION billing_credit_identity_immutable();
DROP FUNCTION billing_audit_lot();

ALTER TABLE "user" DROP COLUMN "billingTrialUsedAt",
DROP COLUMN "byokTrialUsedAt",
DROP COLUMN "byokTrialCheckoutOrganizationId",
DROP COLUMN "byokTrialCheckoutExpiresAt";

ALTER TABLE deployment_settings DROP COLUMN "modelCreditsEnabled";
