"""Track permanent PV reductions and distinct payment/certificate dates.

Revision ID: 20261110_0011
Revises: 20261107_0010
"""

from alembic import op
import sqlalchemy as sa

revision = "20261110_0011"
down_revision = "20261107_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    zero = sa.text("0")
    op.add_column("expenses", sa.Column("canceled_amount", sa.Numeric(14, 2), nullable=False, server_default=zero))
    op.add_column("payment_vouchers", sa.Column("payment_date", sa.Date(), nullable=True))
    op.add_column("payment_vouchers", sa.Column("wht_issue_date", sa.Date(), nullable=True))
    op.add_column("payment_vouchers", sa.Column("canceled_amount", sa.Numeric(14, 2), nullable=False, server_default=zero))
    op.add_column("payment_vouchers", sa.Column("adjustment_reason", sa.Text(), nullable=True))
    op.add_column("payment_voucher_items", sa.Column("canceled_amount", sa.Numeric(14, 2), nullable=False, server_default=zero))
    op.execute("UPDATE payment_vouchers SET payment_date = voucher_date, wht_issue_date = voucher_date")


def downgrade() -> None:
    op.drop_column("payment_voucher_items", "canceled_amount")
    op.drop_column("payment_vouchers", "adjustment_reason")
    op.drop_column("payment_vouchers", "canceled_amount")
    op.drop_column("payment_vouchers", "wht_issue_date")
    op.drop_column("payment_vouchers", "payment_date")
    op.drop_column("expenses", "canceled_amount")
