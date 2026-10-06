"""Initial Vela Construction Expense schema.

Revision ID: 20261006_0001
Revises:
Create Date: 2026-10-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261006_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_projects_code", "projects", ["code"], unique=True)

    op.create_table(
        "cost_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("parent_code", sa.String(length=30), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_cost_codes_code", "cost_codes", ["code"], unique=True)

    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("tax_id", sa.String(length=30), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_vendors_name", "vendors", ["name"], unique=False)
    op.create_index("ix_vendors_tax_id", "vendors", ["tax_id"], unique=False)

    op.create_table(
        "expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("expense_no", sa.String(length=40), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("cost_code_id", sa.Integer(), sa.ForeignKey("cost_codes.id"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("document_no", sa.String(length=100), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False),
        sa.Column("vat_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("withholding_tax", sa.Numeric(14, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("net_paid", sa.Numeric(14, 2), nullable=False),
        sa.Column("payment_status", sa.String(length=30), nullable=False),
        sa.Column("payment_method", sa.String(length=30), nullable=True),
        sa.Column("paperless_document_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("expense_no", name="uq_expense_no"),
    )
    op.create_index("ix_expenses_expense_no", "expenses", ["expense_no"], unique=False)
    op.create_index("ix_expenses_project_id", "expenses", ["project_id"], unique=False)
    op.create_index("ix_expenses_cost_code_id", "expenses", ["cost_code_id"], unique=False)
    op.create_index("ix_expenses_vendor_id", "expenses", ["vendor_id"], unique=False)
    op.create_index("ix_expenses_paperless_document_id", "expenses", ["paperless_document_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_expenses_paperless_document_id", table_name="expenses")
    op.drop_index("ix_expenses_vendor_id", table_name="expenses")
    op.drop_index("ix_expenses_cost_code_id", table_name="expenses")
    op.drop_index("ix_expenses_project_id", table_name="expenses")
    op.drop_index("ix_expenses_expense_no", table_name="expenses")
    op.drop_table("expenses")
    op.drop_index("ix_vendors_tax_id", table_name="vendors")
    op.drop_index("ix_vendors_name", table_name="vendors")
    op.drop_table("vendors")
    op.drop_index("ix_cost_codes_code", table_name="cost_codes")
    op.drop_table("cost_codes")
    op.drop_index("ix_projects_code", table_name="projects")
    op.drop_table("projects")
