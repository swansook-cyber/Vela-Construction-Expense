"""allow installment payment allocations

Revision ID: 20261105_0008
Revises: 20261105_0007
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_0008"
down_revision = "20261105_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_payment_voucher_item_expense", "payment_voucher_items", type_="unique")
    op.add_column("payment_voucher_items", sa.Column("gross_amount", sa.Numeric(14, 2), nullable=False, server_default="0"))
    op.add_column("payment_voucher_items", sa.Column("withholding_tax", sa.Numeric(14, 2), nullable=False, server_default="0"))
    op.add_column("payment_voucher_items", sa.Column("net_amount", sa.Numeric(14, 2), nullable=False, server_default="0"))

    # Backfill existing full-payment links.
    op.execute("""
        UPDATE payment_voucher_items pvi
        SET gross_amount = pv.gross_amount,
            withholding_tax = pv.withholding_tax,
            net_amount = pv.net_amount
        FROM payment_vouchers pv
        WHERE pv.id = pvi.voucher_id
          AND (SELECT COUNT(*) FROM payment_voucher_items x WHERE x.voucher_id = pv.id) = 1
    """)

    # For multi-bill vouchers, backfill each row from the original expense values.
    op.execute("""
        UPDATE payment_voucher_items pvi
        SET gross_amount = e.total_amount,
            withholding_tax = e.withholding_tax,
            net_amount = GREATEST(e.total_amount - e.withholding_tax, 0)
        FROM expenses e
        WHERE e.id = pvi.expense_id
          AND pvi.gross_amount = 0
    """)

    op.alter_column("payment_voucher_items", "gross_amount", server_default=None)
    op.alter_column("payment_voucher_items", "withholding_tax", server_default=None)
    op.alter_column("payment_voucher_items", "net_amount", server_default=None)


def downgrade() -> None:
    op.create_unique_constraint("uq_payment_voucher_item_expense", "payment_voucher_items", ["expense_id"])
    op.drop_column("payment_voucher_items", "net_amount")
    op.drop_column("payment_voucher_items", "withholding_tax")
    op.drop_column("payment_voucher_items", "gross_amount")
