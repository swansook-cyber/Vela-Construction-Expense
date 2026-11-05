"""add default withholding rate to expenses

Revision ID: 20261105_0009
Revises: 20261105_0008
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_0009"
down_revision = "20261105_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("expenses", sa.Column("default_wht_rate", sa.Numeric(5, 2), nullable=True))
    op.execute("""
        UPDATE expenses
        SET default_wht_rate =
            CASE
              WHEN subtotal > 0 AND withholding_tax > 0
              THEN ROUND((withholding_tax / subtotal) * 100, 2)
              ELSE 0
            END
    """)


def downgrade() -> None:
    op.drop_column("expenses", "default_wht_rate")
