from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    status: str


class CostCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    active: bool


class VendorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    tax_id: str | None = None
    phone: str | None = None
    address: str | None = None
    notes: str | None = None


class VendorUpdate(VendorCreate):
    pass


class VendorOut(VendorCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ExpenseCreate(BaseModel):
    project_id: int
    cost_code_id: int
    vendor_id: int | None = None
    expense_date: date
    document_no: str | None = None
    description: str = Field(min_length=1)
    subtotal: Decimal = Decimal("0")
    vat_amount: Decimal = Decimal("0")
    withholding_tax: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    net_paid: Decimal = Decimal("0")
    payment_status: str = "UNPAID"
    payment_method: str | None = None
    paperless_document_id: int | None = None
    notes: str | None = None


class ExpenseOut(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    expense_no: str


class DashboardSummary(BaseModel):
    project_id: int
    project_name: str
    total_expenses: Decimal
    paid_amount: Decimal
    outstanding_amount: Decimal
    expense_count: int
    unpaid_count: int
