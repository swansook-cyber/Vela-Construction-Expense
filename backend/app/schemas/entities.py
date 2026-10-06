from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


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


class ExpenseCreate(BaseModel):
    project_id: int
    cost_code_id: int
    vendor_id: int | None = None
    expense_date: date
    document_no: str | None = None
    description: str
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
