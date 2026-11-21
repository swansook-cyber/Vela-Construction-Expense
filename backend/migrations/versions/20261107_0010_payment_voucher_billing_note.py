"""add billing note number to payment vouchers

Revision ID: 20261107_0010
Revises: 20261105_0009
Create Date: 2026-11-07
"""
from alembic import op
import sqlalchemy as sa

revision = "20261107_0010"
down_revision = "20261105_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payment_vouchers",
        sa.Column("billing_note_no", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payment_vouchers", "billing_note_no")
