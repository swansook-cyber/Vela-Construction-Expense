"""add vendor cheque payee name

Revision ID: 20261105_0006
Revises: 20261105_0005
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_0006"
down_revision = "20261105_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("cheque_payee_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "cheque_payee_name")
