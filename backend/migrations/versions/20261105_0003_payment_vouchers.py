"""Add payment vouchers, withholding certificate and cheque fields.

Revision ID: 20261105_0003
Revises: 20261006_0002
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261105_0003"
down_revision: Union[str, None] = "20261006_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "payment_vouchers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("voucher_no", sa.String(length=40), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("expense_id", sa.Integer(), sa.ForeignKey("expenses.id"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
        sa.Column("voucher_date", sa.Date(), nullable=False),
        sa.Column("gross_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("withholding_tax", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("net_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("payment_method", sa.String(length=30), nullable=True),
        sa.Column("payee_name", sa.String(length=255), nullable=False),
        sa.Column("wht_certificate_no", sa.String(length=40), nullable=True),
        sa.Column("cheque_no", sa.String(length=80), nullable=True),
        sa.Column("cheque_date", sa.Date(), nullable=True),
        sa.Column("bank_name", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="ISSUED"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("voucher_no", name="uq_payment_voucher_no"),
        sa.UniqueConstraint("expense_id", name="uq_payment_voucher_expense"),
        sa.UniqueConstraint("wht_certificate_no", name="uq_payment_voucher_wht_certificate_no"),
    )
    op.create_index("ix_payment_vouchers_voucher_no", "payment_vouchers", ["voucher_no"], unique=False)
    op.create_index("ix_payment_vouchers_project_id", "payment_vouchers", ["project_id"], unique=False)
    op.create_index("ix_payment_vouchers_expense_id", "payment_vouchers", ["expense_id"], unique=False)
    op.create_index("ix_payment_vouchers_vendor_id", "payment_vouchers", ["vendor_id"], unique=False)
    op.create_index("ix_payment_vouchers_wht_certificate_no", "payment_vouchers", ["wht_certificate_no"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_payment_vouchers_wht_certificate_no", table_name="payment_vouchers")
    op.drop_index("ix_payment_vouchers_vendor_id", table_name="payment_vouchers")
    op.drop_index("ix_payment_vouchers_expense_id", table_name="payment_vouchers")
    op.drop_index("ix_payment_vouchers_project_id", table_name="payment_vouchers")
    op.drop_index("ix_payment_vouchers_voucher_no", table_name="payment_vouchers")
    op.drop_table("payment_vouchers")
