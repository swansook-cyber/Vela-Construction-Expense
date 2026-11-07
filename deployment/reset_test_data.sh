#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="./backups"
BACKUP_FILE="$BACKUP_DIR/pre-production-reset-$STAMP.sql"

mkdir -p "$BACKUP_DIR"

echo "== Sea Mountain: reset test transaction data =="
echo "1/4 Backing up PostgreSQL to $BACKUP_FILE"
docker compose exec -T db sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "Backup failed or backup file is empty. Nothing was deleted." >&2
  exit 1
fi

echo "2/4 Current transaction counts"
docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT 'expenses' AS table_name, count(*) AS rows FROM expenses
UNION ALL
SELECT 'payment_vouchers', count(*) FROM payment_vouchers
UNION ALL
SELECT 'payment_voucher_items', count(*) FROM payment_voucher_items
UNION ALL
SELECT 'audit_logs', count(*) FROM audit_logs
ORDER BY table_name;
SQL

echo "3/4 Deleting test transaction data and resetting identities"
docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
TRUNCATE TABLE
  payment_voucher_items,
  payment_vouchers,
  expenses,
  audit_logs
RESTART IDENTITY;
COMMIT;
SQL

echo "4/4 Verifying preserved master data and empty transactions"
docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT 'company_profiles' AS table_name, count(*) AS rows FROM company_profiles
UNION ALL
SELECT 'projects', count(*) FROM projects
UNION ALL
SELECT 'cost_codes', count(*) FROM cost_codes
UNION ALL
SELECT 'vendors', count(*) FROM vendors
UNION ALL
SELECT 'expenses', count(*) FROM expenses
UNION ALL
SELECT 'payment_vouchers', count(*) FROM payment_vouchers
UNION ALL
SELECT 'payment_voucher_items', count(*) FROM payment_voucher_items
UNION ALL
SELECT 'audit_logs', count(*) FROM audit_logs
ORDER BY table_name;
SQL

echo
echo "PASS: test transaction data reset complete."
echo "Backup: $BACKUP_FILE"
echo "Preserved: company profile, projects, cost codes, vendors, schema/migrations."
echo "Not touched: Paperless-ngx documents/media."
