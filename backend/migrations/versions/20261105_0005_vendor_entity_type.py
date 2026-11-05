"""Add vendor entity type for WHT form selection.

Revision ID: 20261105_0005
Revises: 20261105_0004
Create Date: 2026-11-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20261105_0005"
down_revision: Union[str, None] = "20261105_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column("vendors", sa.Column("entity_type", sa.String(length=30), nullable=False, server_default="UNKNOWN"))

def downgrade() -> None:
    op.drop_column("vendors", "entity_type")
