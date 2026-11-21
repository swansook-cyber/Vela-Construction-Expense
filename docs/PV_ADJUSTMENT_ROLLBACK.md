# PV adjustment migration and rollback

This branch is for development and QA. Do not deploy it without a separate production approval.

Migration `20261110_0011` adds `expenses.canceled_amount`,
`payment_voucher_items.canceled_amount`, the voucher's cancellation total and
reason, and independent payment and WHT issue dates. It backfills the two dates
from the existing PV date. Original invoice amounts and document links remain
unchanged.

Before any future deployment, record the production Git SHA and container image
IDs, and take a verified PostgreSQL custom-format backup:

```sh
docker compose exec -T db sh -lc 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > pre-pv-adjustment.dump
test -s pre-pv-adjustment.dump
docker compose ps
```

Only use the commands above after verifying the actual production Compose
directory and database service. Never run the test-data reset script for this
change.

For an application rollback **before any adjustment is saved**, restore the
previous backend and frontend images/commit. The added columns are compatible
with the previous application and can remain in place. If the schema itself
must be reverted, first confirm no adjusted PV exists, retain the backup, then
run `alembic downgrade 20261107_0010` in a controlled maintenance window.
That downgrade drops the new cancellation and date fields.

After an adjustment has been saved, do **not** run the old application or drop
the columns: the old balance formula would show canceled amounts as unpaid.
Restore the full database backup only if losing all subsequent writes is
explicitly approved; otherwise prepare a forward fix that preserves the
adjustment and audit records. The audit log stores old/new voucher allocations,
expense balances, reason, and timestamp for reconciliation.
