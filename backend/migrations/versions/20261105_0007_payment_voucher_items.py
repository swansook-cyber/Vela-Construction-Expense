"""support multiple expenses per payment voucher

Revision ID: 20261105_0007
Revises: 20261105_0006
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_0007"
down_revision = "20261105_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment_voucher_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("voucher_id", sa.Integer(), sa.ForeignKey("payment_vouchers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expense_id", sa.Integer(), sa.ForeignKey("expenses.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("expense_id", name="uq_payment_voucher_item_expense"),
    )
    op.create_index("ix_payment_voucher_items_voucher_id", "payment_voucher_items", ["voucher_id"])
    op.create_index("ix_payment_voucher_items_expense_id", "payment_voucher_items", ["expense_id"])

    # Preserve existing one-expense vouchers in the new item table.
    op.execute("""
        INSERT INTO payment_voucher_items (voucher_id, expense_id, created_at)
        SELECT id, expense_id, CURRENT_TIMESTAMP
        FROM payment_vouchers
        WHERE expense_id IS NOT NULL
    """)

    op.drop_constraint("uq_payment_voucher_expense", "payment_vouchers", type_="unique")
    op.alter_column("payment_vouchers", "expense_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.execute("""
        UPDATE payment_vouchers pv
        SET expense_id = (
            SELECT pvi.expense_id
            FROM payment_voucher_items pvi
            WHERE pvi.voucher_id = pv.id
            ORDER BY pvi.id
            LIMIT 1
        )
        WHERE pv.expense_id IS NULL
    """)
    op.alter_column("payment_vouchers", "expense_id", existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint("uq_payment_voucher_expense", "payment_vouchers", ["expense_id"])
    op.drop_index("ix_payment_voucher_items_expense_id", table_name="payment_voucher_items")
    op.drop_index("ix_payment_voucher_items_voucher_id", table_name="payment_voucher_items")
    op.drop_table("payment_voucher_items")
