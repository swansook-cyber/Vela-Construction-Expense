"""Add company profile and WHT metadata.

Revision ID: 20261105_0004
Revises: 20261105_0003
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261105_0004"
down_revision: Union[str, None] = "20261105_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("legal_name", sa.String(length=255), nullable=False, server_default="Sea Mountain"),
        sa.Column("tax_id", sa.String(length=30), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("branch", sa.String(length=100), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.execute("INSERT INTO company_profiles (id, legal_name) VALUES (1, 'Sea Mountain')")
    op.add_column("payment_vouchers", sa.Column("wht_rate", sa.Numeric(5, 2), nullable=True))
    op.add_column("payment_vouchers", sa.Column("income_type", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("payment_vouchers", "income_type")
    op.drop_column("payment_vouchers", "wht_rate")
    op.drop_table("company_profiles")
