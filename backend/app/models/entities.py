from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CostCode(Base):
    __tablename__ = "cost_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    parent_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    tax_id: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (UniqueConstraint("expense_no", name="uq_expense_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_no: Mapped[str] = mapped_column(String(40), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    cost_code_id: Mapped[int] = mapped_column(ForeignKey("cost_codes.id"), index=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"), nullable=True, index=True)
    expense_date: Mapped[date] = mapped_column(Date)
    document_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    withholding_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    net_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    payment_status: Mapped[str] = mapped_column(String(30), default="UNPAID")
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    paperless_document_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project = relationship("Project")
    cost_code = relationship("CostCode")
    vendor = relationship("Vendor")
