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


class CompanyProfile(Base):
    __tablename__ = "company_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    legal_name: Mapped[str] = mapped_column(String(255), default="Sea Mountain")
    tax_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    branch: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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
    cheque_payee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
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
    default_wht_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    net_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    payment_status: Mapped[str] = mapped_column(String(30), default="UNPAID")
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    paperless_document_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    document_task_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project")
    cost_code = relationship("CostCode")
    vendor = relationship("Vendor")


class PaymentVoucher(Base):
    __tablename__ = "payment_vouchers"
    __table_args__ = (
        UniqueConstraint("voucher_no", name="uq_payment_voucher_no"),
        UniqueConstraint("expense_id", name="uq_payment_voucher_expense"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    voucher_no: Mapped[str] = mapped_column(String(40), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    expense_id: Mapped[int | None] = mapped_column(ForeignKey("expenses.id"), nullable=True, index=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"), nullable=True, index=True)
    voucher_date: Mapped[date] = mapped_column(Date)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    withholding_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    wht_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    income_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    payee_name: Mapped[str] = mapped_column(String(255))
    wht_certificate_no: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True, index=True)
    cheque_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cheque_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ISSUED")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project")
    expense = relationship("Expense")
    vendor = relationship("Vendor")
    items = relationship("PaymentVoucherItem", back_populates="voucher", cascade="all, delete-orphan", order_by="PaymentVoucherItem.id")

    @property
    def expense_ids(self) -> list[int]:
        if self.items:
            return [item.expense_id for item in self.items]
        return [self.expense_id] if self.expense_id is not None else []

    @property
    def allocations(self):
        return self.items


class PaymentVoucherItem(Base):
    __tablename__ = "payment_voucher_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    voucher_id: Mapped[int] = mapped_column(ForeignKey("payment_vouchers.id", ondelete="CASCADE"), index=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id"), index=True)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    withholding_tax: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    voucher = relationship("PaymentVoucher", back_populates="items")
    expense = relationship("Expense")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50), index=True)
    actor: Mapped[str] = mapped_column(String(100), default="system")
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
