import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.entities import AuditLog, CostCode, Expense, Project, Vendor
from app.services.paperless import PaperlessClient
from app.services.ocr_review import analyze_ocr_document
from app.schemas.entities import (
    AuditLogOut,
    CostCodeOut,
    CostCodeSummary,
    DashboardSummary,
    DocumentLink,
    ExpenseCreate,
    ExpenseOut,
    ExpenseUpdate,
    ExpenseVoid,
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


def add_audit(
    db: Session,
    entity_type: str,
    entity_id: int | None,
    action: str,
    details: dict[str, Any] | None = None,
    actor: str = "system",
) -> None:
    db.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor=actor,
            details=json.dumps(details, ensure_ascii=False, default=str) if details else None,
        )
    )


def expense_snapshot(expense: Expense) -> dict[str, Any]:
    return {
        "project_id": expense.project_id,
        "cost_code_id": expense.cost_code_id,
        "vendor_id": expense.vendor_id,
        "expense_date": expense.expense_date.isoformat(),
        "document_no": expense.document_no,
        "description": expense.description,
        "subtotal": str(expense.subtotal),
        "vat_amount": str(expense.vat_amount),
        "withholding_tax": str(expense.withholding_tax),
        "total_amount": str(expense.total_amount),
        "net_paid": str(expense.net_paid),
        "payment_status": expense.payment_status,
        "payment_method": expense.payment_method,
        "paperless_document_id": expense.paperless_document_id,
        "document_task_id": expense.document_task_id,
        "notes": expense.notes,
    }


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
    if payload.payment_status not in VALID_PAYMENT_STATUSES - {"VOID"}:
        raise HTTPException(status_code=400, detail="Use the void action to cancel an expense")
    if payload.subtotal < 0 or payload.vat_amount < 0 or payload.withholding_tax < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if payload.total_amount < 0 or payload.net_paid < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")

    vendor_payable = max(payload.total_amount - payload.withholding_tax, Decimal("0"))
    if payload.net_paid > vendor_payable:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed vendor payable")


def _extract_document_id(payload: Any) -> int | None:
    if isinstance(payload, list):
        for item in payload:
            found = _extract_document_id(item)
            if found is not None:
                return found
        return None

    if not isinstance(payload, dict):
        return None

    for key in ("related_document", "document_id", "document"):
        value = payload.get(key)
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
        if isinstance(value, dict):
            for nested_key in ("id", "pk"):
                nested = value.get(nested_key)
                if isinstance(nested, int) and nested > 0:
                    return nested
                if isinstance(nested, str) and nested.isdigit():
                    return int(nested)

    for value in payload.values():
        if isinstance(value, (dict, list)):
            found = _extract_document_id(value)
            if found is not None:
                return found

    return None


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
    db.flush()
    add_audit(db, "vendor", vendor.id, "CREATE", {"name": vendor.name})
    db.commit()
    db.refresh(vendor)
    return vendor


@router.put("/vendors/{vendor_id}", response_model=VendorOut)
def update_vendor(vendor_id: int, payload: VendorUpdate, db: Session = Depends(get_db)):
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    before = {"name": vendor.name, "tax_id": vendor.tax_id, "phone": vendor.phone}
    for key, value in payload.model_dump().items():
        setattr(vendor, key, value)
    add_audit(
        db,
        "vendor",
        vendor.id,
        "UPDATE",
        {"before": before, "after": {"name": vendor.name, "tax_id": vendor.tax_id, "phone": vendor.phone}},
    )
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
    add_audit(db, "vendor", vendor.id, "DELETE", {"name": vendor.name})
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


@router.get("/expenses/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, db: Session = Depends(get_db)):
    expense = db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(payload: ExpenseCreate, db: Session = Depends(get_db)):
    validate_expense(payload, db)
    expense = Expense(
        expense_no=next_expense_no(db, payload.expense_date),
        **payload.model_dump(),
    )
    db.add(expense)
    db.flush()
    add_audit(db, "expense", expense.id, "CREATE", expense_snapshot(expense))
    db.commit()
    db.refresh(expense)
    return expense


@router.put("/expenses/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, payload: ExpenseUpdate, db: Session = Depends(get_db)):
    expense = db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if expense.payment_status == "VOID":
        raise HTTPException(status_code=409, detail="Voided expense cannot be edited")

    validate_expense(payload, db)
    before = expense_snapshot(expense)
    for key, value in payload.model_dump().items():
        setattr(expense, key, value)
    expense.updated_at = datetime.utcnow()
    add_audit(
        db,
        "expense",
        expense.id,
        "UPDATE",
        {"before": before, "after": expense_snapshot(expense)},
    )
    db.commit()
    db.refresh(expense)
    return expense


@router.post("/expenses/{expense_id}/void", response_model=ExpenseOut)
def void_expense(expense_id: int, payload: ExpenseVoid, db: Session = Depends(get_db)):
    expense = db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if expense.payment_status == "VOID":
        raise HTTPException(status_code=409, detail="Expense is already voided")

    before = expense_snapshot(expense)
    expense.payment_status = "VOID"
    expense.void_reason = payload.reason
    expense.voided_at = datetime.utcnow()
    expense.updated_at = datetime.utcnow()
    add_audit(
        db,
        "expense",
        expense.id,
        "VOID",
        {"reason": payload.reason, "before": before},
    )
    db.commit()
    db.refresh(expense)
    return expense


@router.put("/expenses/{expense_id}/document", response_model=ExpenseOut)
def link_document(expense_id: int, payload: DocumentLink, db: Session = Depends(get_db)):
    expense = db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    expense.paperless_document_id = payload.paperless_document_id
    expense.updated_at = datetime.utcnow()
    add_audit(
        db,
        "expense",
        expense.id,
        "LINK_DOCUMENT",
        {"paperless_document_id": payload.paperless_document_id},
    )
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


@router.get("/reports/{project_id}/cost-codes", response_model=list[CostCodeSummary])
def cost_code_report(project_id: int, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    codes = db.scalars(select(CostCode).order_by(CostCode.code)).all()
    expenses = db.scalars(
        select(Expense).where(
            Expense.project_id == project_id,
            Expense.payment_status != "VOID",
        )
    ).all()

    rows: list[CostCodeSummary] = []
    for code in codes:
        items = [e for e in expenses if e.cost_code_id == code.id]
        if not items:
            continue
        subtotal = sum((Decimal(e.subtotal or 0) for e in items), Decimal("0"))
        vat = sum((Decimal(e.vat_amount or 0) for e in items), Decimal("0"))
        wht = sum((Decimal(e.withholding_tax or 0) for e in items), Decimal("0"))
        total = sum((Decimal(e.total_amount or 0) for e in items), Decimal("0"))
        payable = sum(
            (max(Decimal(e.total_amount or 0) - Decimal(e.withholding_tax or 0), Decimal("0")) for e in items),
            Decimal("0"),
        )
        paid = sum((Decimal(e.net_paid or 0) for e in items), Decimal("0"))
        rows.append(
            CostCodeSummary(
                cost_code_id=code.id,
                code=code.code,
                name=code.name,
                expense_count=len(items),
                subtotal=subtotal,
                vat_amount=vat,
                withholding_tax=wht,
                total_amount=total,
                vendor_payable=payable,
                paid_amount=paid,
                outstanding_amount=max(payable - paid, Decimal("0")),
            )
        )
    return rows


@router.get("/reports/{project_id}/expenses.csv")
def expense_csv(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    expenses = db.scalars(
        select(Expense)
        .where(Expense.project_id == project_id)
        .order_by(Expense.expense_date, Expense.id)
    ).all()

    cost_codes = {c.id: c for c in db.scalars(select(CostCode)).all()}
    vendors = {v.id: v for v in db.scalars(select(Vendor)).all()}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Expense No",
        "Date",
        "Description",
        "Cost Code",
        "Vendor",
        "Document No",
        "Subtotal",
        "VAT",
        "Withholding Tax",
        "Document Total",
        "Paid",
        "Payment Status",
        "Payment Method",
        "Paperless Document ID",
        "Void Reason",
        "Notes",
    ])
    for expense in expenses:
        code = cost_codes.get(expense.cost_code_id)
        vendor = vendors.get(expense.vendor_id) if expense.vendor_id else None
        writer.writerow([
            expense.expense_no,
            expense.expense_date.isoformat(),
            expense.description,
            f"{code.code} {code.name}" if code else "",
            vendor.name if vendor else "",
            expense.document_no or "",
            expense.subtotal,
            expense.vat_amount,
            expense.withholding_tax,
            expense.total_amount,
            expense.net_paid,
            expense.payment_status,
            expense.payment_method or "",
            expense.paperless_document_id or "",
            expense.void_reason or "",
            expense.notes or "",
        ])

    filename = f"{project.code}-expenses.csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/audit-logs", response_model=list[AuditLogOut])
def audit_logs(
    entity_type: str | None = None,
    entity_id: int | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 500))
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    stmt = stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)
    return db.scalars(stmt).all()


@router.get("/documents/status")
def document_status():
    client = PaperlessClient()
    return {"configured": client.configured}


@router.post("/documents/upload")
async def upload_document(
    document: UploadFile = File(...),
    title: str | None = Form(default=None),
    created: str | None = Form(default=None),
    expense_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
):
    client = PaperlessClient()
    if not client.configured:
        raise HTTPException(status_code=503, detail="Paperless-ngx is not configured")

    expense = None
    if expense_id is not None:
        expense = db.get(Expense, expense_id)
        if not expense:
            raise HTTPException(status_code=404, detail="Expense not found")
        if expense.payment_status == "VOID":
            raise HTTPException(status_code=409, detail="Cannot attach a document to a voided expense")

    allowed = {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
    }
    if document.content_type not in allowed:
        raise HTTPException(status_code=400, detail="รองรับเฉพาะ PDF, JPG, PNG และ WEBP")

    content = await document.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="ไฟล์ต้องไม่เกิน 20 MB")

    try:
        task_id = await client.upload_document(
            filename=document.filename or "document",
            content=content,
            content_type=document.content_type or "application/octet-stream",
            title=title,
            created=created,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Paperless upload failed: {exc}") from exc

    if expense:
        expense.document_task_id = task_id
        expense.updated_at = datetime.utcnow()
        add_audit(
            db,
            "expense",
            expense.id,
            "DOCUMENT_UPLOAD",
            {"task_id": task_id, "filename": document.filename},
        )
        db.commit()

    return {"task_id": task_id, "status": "QUEUED", "expense_id": expense_id}


@router.get("/documents/tasks/{task_id}")
async def document_task(task_id: str, db: Session = Depends(get_db)):
    client = PaperlessClient()
    if not client.configured:
        raise HTTPException(status_code=503, detail="Paperless-ngx is not configured")
    try:
        task = await client.get_task(task_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Paperless task lookup failed: {exc}") from exc

    linked_expense = db.scalar(select(Expense).where(Expense.document_task_id == task_id))
    document_id = _extract_document_id(task)

    if linked_expense and document_id and linked_expense.paperless_document_id != document_id:
        linked_expense.paperless_document_id = document_id
        linked_expense.updated_at = datetime.utcnow()
        add_audit(
            db,
            "expense",
            linked_expense.id,
            "DOCUMENT_LINKED_FROM_OCR",
            {"task_id": task_id, "paperless_document_id": document_id},
        )
        db.commit()

    return {
        "task": task,
        "linked_expense_id": linked_expense.id if linked_expense else None,
        "paperless_document_id": document_id,
    }


@router.get("/documents/{document_id}/review")
async def review_document(document_id: int):
    client = PaperlessClient()
    if not client.configured:
        raise HTTPException(status_code=503, detail="Paperless-ngx is not configured")
    try:
        document = await client.get_document(document_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Paperless document lookup failed: {exc}") from exc
    return analyze_ocr_document(document)
