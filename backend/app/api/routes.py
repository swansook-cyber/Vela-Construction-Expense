from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.entities import CostCode, Expense, Project
from app.schemas.entities import CostCodeOut, ExpenseCreate, ExpenseOut, ProjectOut

router = APIRouter(prefix="/api/v1")


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


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.scalars(select(Project).order_by(Project.name)).all()


@router.get("/cost-codes", response_model=list[CostCodeOut])
def list_cost_codes(db: Session = Depends(get_db)):
    return db.scalars(select(CostCode).where(CostCode.active.is_(True)).order_by(CostCode.code)).all()


@router.get("/expenses", response_model=list[ExpenseOut])
def list_expenses(db: Session = Depends(get_db)):
    return db.scalars(select(Expense).order_by(Expense.expense_date.desc(), Expense.id.desc())).all()


@router.post("/expenses", response_model=ExpenseOut)
def create_expense(payload: ExpenseCreate, db: Session = Depends(get_db)):
    if not db.get(Project, payload.project_id):
        raise HTTPException(status_code=400, detail="Invalid project")
    if not db.get(CostCode, payload.cost_code_id):
        raise HTTPException(status_code=400, detail="Invalid cost code")

    expense = Expense(
        expense_no=next_expense_no(db, payload.expense_date),
        **payload.model_dump(),
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense
