from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.entities import CostCode, Expense, Project, Vendor
from app.schemas.entities import (
    CostCodeOut,
    DashboardSummary,
    ExpenseCreate,
    ExpenseOut,
    ProjectOut,
    VendorCreate,
    VendorOut,
    VendorUpdate,
)

router = APIRouter(prefix="/api/v1")

VALID_PAYMENT_STATUSES = {"UNPAID", "PARTIAL", "PAID", "VOID"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def next_expense_no(db: Session, expense_date: date) -> str:
    year = expense_date.year
    prefix = f"EXP-{year}-"
    count = db.scalar(select(func.count(Expense.id)).where(Expense.expense_no.like(f"{prefix}%"))) or 0
    return f"{prefix}{count + 1:05d}"


def validate_expense(payload: ExpenseCreate, db: Session) -> None:
    if not db.get(Project, payload.project_id):
        raise HTTPException(status_code=400, detail="Invalid project")
    if not db.get(CostCode, payload.cost_code_id):
        raise HTTPException(status_code=400, detail="Invalid cost code")
    if payload.vendor_id is not None and not db.get(Vendor, payload.vendor_id):
        raise HTTPException(status_code=400, detail="Invalid vendor")
    if payload.payment_status not in VALID_PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payment status")
    if payload.subtotal < 0 or payload.vat_amount < 0 or payload.withholding_tax < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if payload.total_amount < 0 or payload.net_paid < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if payload.net_paid > payload.total_amount:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed total amount")


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.scalars(select(Project).order_by(Project.name)).all()


@router.get("/cost-codes", response_model=list[CostCodeOut])
def list_cost_codes(db: Session = Depends(get_db)):
    return db.scalars(select(CostCode).where(CostCode.active.is_(True)).order_by(CostCode.code)).all()


@router.get("/vendors", response_model=list[VendorOut])
def list_vendors(db: Session = Depends(get_db)):
    return db.scalars(select(Vendor).order_by(Vendor.name)).all()


@router.post("/vendors", response_model=VendorOut, status_code=201)
def create_vendor(payload: VendorCreate, db: Session = Depends(get_db)):
    vendor = Vendor(**payload.model_dump())
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.put("/vendors/{vendor_id}", response_model=VendorOut)
def update_vendor(vendor_id: int, payload: VendorUpdate, db: Session = Depends(get_db)):
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    for key, value in payload.model_dump().items():
        setattr(vendor, key, value)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.delete("/vendors/{vendor_id}", status_code=204)
def delete_vendor(vendor_id: int, db: Session = Depends(get_db)):
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    linked = db.scalar(select(func.count(Expense.id)).where(Expense.vendor_id == vendor_id)) or 0
    if linked:
        raise HTTPException(status_code=409, detail="Vendor is used by expenses")
    db.delete(vendor)
    db.commit()
    return None


@router.get("/expenses", response_model=list[ExpenseOut])
def list_expenses(project_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(Expense)
    if project_id is not None:
        stmt = stmt.where(Expense.project_id == project_id)
    stmt = stmt.order_by(Expense.expense_date.desc(), Expense.id.desc())
    return db.scalars(stmt).all()


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(payload: ExpenseCreate, db: Session = Depends(get_db)):
    validate_expense(payload, db)
    expense = Expense(
        expense_no=next_expense_no(db, payload.expense_date),
        **payload.model_dump(),
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.get("/dashboard/{project_id}", response_model=DashboardSummary)
def dashboard(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    expenses = db.scalars(
        select(Expense).where(
            Expense.project_id == project_id,
            Expense.payment_status != "VOID",
        )
    ).all()

    total = sum((Decimal(e.total_amount or 0) for e in expenses), Decimal("0"))
    paid = sum((Decimal(e.net_paid or 0) for e in expenses), Decimal("0"))
    vendor_payable = sum(
        (
            max(
                Decimal(e.total_amount or 0) - Decimal(e.withholding_tax or 0),
                Decimal("0"),
            )
            for e in expenses
        ),
        Decimal("0"),
    )
    outstanding = max(vendor_payable - paid, Decimal("0"))
    unpaid_count = sum(1 for e in expenses if e.payment_status in {"UNPAID", "PARTIAL"})

    return DashboardSummary(
        project_id=project.id,
        project_name=project.name,
        total_expenses=total,
        paid_amount=paid,
        outstanding_amount=outstanding,
        expense_count=len(expenses),
        unpaid_count=unpaid_count,
    )
