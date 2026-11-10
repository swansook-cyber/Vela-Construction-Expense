import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.entities import AuditLog, CompanyProfile, CostCode, Expense, PaymentVoucher, PaymentVoucherItem, Project, Vendor
from app.services.paperless import PaperlessClient
from app.services.ocr_review import analyze_ocr_document
from app.schemas.entities import (
    AuditLogOut,
    CompanyProfileOut,
    CompanyProfileUpdate,
    CostCodeOut,
    CostCodeSummary,
    DashboardSummary,
    DocumentLink,
    ExpenseCreate,
    ExpenseOut,
    ExpenseUpdate,
    ExpenseVoid,
    PaymentVoucherCreate,
    PaymentVoucherAdjustment,
    PaymentVoucherOut,
    PaymentVoucherPaymentUpdate,
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


def expense_outstanding(expense: Expense) -> Decimal:
    return max(Decimal(expense.total_amount or 0) - Decimal(expense.canceled_amount or 0) -
               Decimal(expense.withholding_tax or 0) - Decimal(expense.net_paid or 0), Decimal("0"))


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
        "canceled_amount": str(expense.canceled_amount),
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


def next_voucher_no(db: Session, voucher_date: date) -> str:
    year = voucher_date.year
    prefix = f"PV-{year}-"
    count = db.scalar(select(func.count(PaymentVoucher.id)).where(PaymentVoucher.voucher_no.like(f"{prefix}%"))) or 0
    return f"{prefix}{count + 1:05d}"


def next_wht_no(db: Session, voucher_date: date) -> str:
    year = voucher_date.year
    prefix = f"WHT-{year}-"
    count = db.scalar(select(func.count(PaymentVoucher.id)).where(PaymentVoucher.wht_certificate_no.like(f"{prefix}%"))) or 0
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


@router.get("/company-profile", response_model=CompanyProfileOut)
def get_company_profile(db: Session = Depends(get_db)):
    profile = db.get(CompanyProfile, 1)
    if not profile:
        profile = CompanyProfile(id=1, legal_name="Sea Mountain")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.put("/company-profile", response_model=CompanyProfileOut)
def update_company_profile(payload: CompanyProfileUpdate, db: Session = Depends(get_db)):
    profile = db.get(CompanyProfile, 1)
    if not profile:
        profile = CompanyProfile(id=1, legal_name=payload.legal_name)
        db.add(profile)
    for key, value in payload.model_dump().items():
        setattr(profile, key, value)
    profile.updated_at = datetime.utcnow()
    add_audit(db, "company_profile", 1, "UPDATE", payload.model_dump())
    db.commit()
    db.refresh(profile)
    return profile


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

    linked_item = db.scalar(
        select(PaymentVoucherItem).where(PaymentVoucherItem.expense_id == expense_id)
    )
    linked_legacy_voucher = db.scalar(
        select(PaymentVoucher).where(PaymentVoucher.expense_id == expense_id)
    )
    if linked_item or linked_legacy_voucher or expense.payment_status in {"PAID", "PARTIAL"} or Decimal(expense.net_paid or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail="รายการนี้มีการจ่ายหรือใบสำคัญจ่ายแล้ว ไม่สามารถยกเลิกจากทะเบียนค่าใช้จ่ายได้",
        )

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


@router.get("/payment-vouchers", response_model=list[PaymentVoucherOut])
def list_payment_vouchers(project_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(PaymentVoucher)
    if project_id is not None:
        stmt = stmt.where(PaymentVoucher.project_id == project_id)
    stmt = stmt.order_by(PaymentVoucher.voucher_date.desc(), PaymentVoucher.id.desc())
    return db.scalars(stmt).all()


@router.post("/payment-vouchers", response_model=PaymentVoucherOut, status_code=201)
def create_payment_voucher(payload: PaymentVoucherCreate, db: Session = Depends(get_db)):
    # New flow: explicit per-expense allocations. Legacy callers still work by
    # supplying expense_ids / expense_id and paying each selected expense in full.
    if payload.allocations:
        allocation_payloads = payload.allocations
    else:
        requested_ids = list(dict.fromkeys(payload.expense_ids or ([] if payload.expense_id is None else [payload.expense_id])))
        if not requested_ids:
            raise HTTPException(status_code=400, detail="At least one expense is required")
        legacy_expenses = db.scalars(select(Expense).where(Expense.id.in_(requested_ids))).all()
        legacy_map = {expense.id: expense for expense in legacy_expenses}
        allocation_payloads = []
        for expense_id in requested_ids:
            expense = legacy_map.get(expense_id)
            if not expense:
                raise HTTPException(status_code=404, detail="One or more expenses were not found")
            allocation_payloads.append(
                {
                    "expense_id": expense.id,
                    "gross_amount": Decimal(expense.total_amount or 0),
                    "withholding_tax": Decimal(expense.withholding_tax or 0),
                }
            )

    normalized = []
    seen_ids = set()
    for allocation in allocation_payloads:
        expense_id = allocation.expense_id if hasattr(allocation, "expense_id") else allocation["expense_id"]
        gross = Decimal(allocation.gross_amount if hasattr(allocation, "gross_amount") else allocation["gross_amount"])
        wht = Decimal(allocation.withholding_tax if hasattr(allocation, "withholding_tax") else allocation["withholding_tax"])
        if expense_id in seen_ids:
            raise HTTPException(status_code=400, detail="Duplicate expense allocation")
        seen_ids.add(expense_id)
        if gross <= 0:
            raise HTTPException(status_code=400, detail="Payment installment amount must be greater than zero")
        if wht < 0 or wht > gross:
            raise HTTPException(status_code=400, detail="Invalid withholding tax amount")
        normalized.append((expense_id, gross, wht))

    expense_ids = [row[0] for row in normalized]
    expenses = db.scalars(select(Expense).where(Expense.id.in_(expense_ids)).order_by(Expense.id).with_for_update()).all()
    if len(expenses) != len(expense_ids):
        raise HTTPException(status_code=404, detail="One or more expenses were not found")
    expense_map = {expense.id: expense for expense in expenses}
    expenses = [expense_map[expense_id] for expense_id in expense_ids]

    if any(expense.payment_status == "VOID" for expense in expenses):
        raise HTTPException(status_code=409, detail="Voided expense cannot be paid")
    if any(expense.project_id != payload.project_id for expense in expenses):
        raise HTTPException(status_code=400, detail="Expense project mismatch")

    vendor_ids = {expense.vendor_id for expense in expenses}
    if len(vendor_ids) != 1:
        raise HTTPException(status_code=400, detail="All expenses in one payment voucher must have the same vendor")
    expense_vendor_id = next(iter(vendor_ids))
    if payload.vendor_id != expense_vendor_id:
        raise HTTPException(status_code=400, detail="Payment voucher vendor must match selected expenses")
    if payload.vendor_id is not None and not db.get(Vendor, payload.vendor_id):
        raise HTTPException(status_code=400, detail="Invalid vendor")

    allocation_rows = []
    for expense_id, gross, wht in normalized:
        expense = expense_map[expense_id]
        previous_items = db.scalars(
            select(PaymentVoucherItem).where(PaymentVoucherItem.expense_id == expense_id)
        ).all()
        allocated_gross = sum((Decimal(item.gross_amount or 0) for item in previous_items), Decimal("0"))
        manual_gross = Decimal("0")
        if not previous_items:
            manual_gross = min(
                Decimal(expense.total_amount or 0),
                Decimal(expense.net_paid or 0) + Decimal(expense.withholding_tax or 0),
            )
        already_allocated = max(allocated_gross, manual_gross)
        remaining = max(Decimal(expense.total_amount or 0) - Decimal(expense.canceled_amount or 0) - already_allocated, Decimal("0"))
        if gross > remaining + Decimal("0.01"):
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount exceeds remaining balance for {expense.expense_no}",
            )
        net = max(gross - wht, Decimal("0"))
        allocation_rows.append((expense, gross, wht, net, already_allocated))

    gross_amount = sum((row[1] for row in allocation_rows), Decimal("0"))
    withholding_tax = sum((row[2] for row in allocation_rows), Decimal("0"))
    net_amount = sum((row[3] for row in allocation_rows), Decimal("0"))

    if abs(Decimal(payload.gross_amount) - gross_amount) > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Gross amount must equal allocation total")
    if abs(Decimal(payload.withholding_tax) - withholding_tax) > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Withholding tax must equal allocation total")
    if abs(Decimal(payload.net_amount) - net_amount) > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Net amount must equal allocation net total")
    if payload.payment_method == "CHEQUE" and (not payload.bank_name or not payload.cheque_no or not payload.cheque_date):
        raise HTTPException(status_code=400, detail="Cheque payment requires bank name, cheque number and cheque date")

    voucher_data = payload.model_dump(exclude={"expense_ids", "allocations"})
    voucher_data["payment_date"] = payload.payment_date or payload.voucher_date
    voucher_data["wht_issue_date"] = payload.wht_issue_date or voucher_data["payment_date"] if withholding_tax > 0 else None
    voucher_data["expense_id"] = expense_ids[0]  # legacy primary reference
    voucher = PaymentVoucher(
        voucher_no=next_voucher_no(db, payload.voucher_date),
        wht_certificate_no=next_wht_no(db, payload.voucher_date) if withholding_tax > 0 else None,
        **voucher_data,
    )
    db.add(voucher)
    db.flush()

    for expense, gross, wht, net, already_allocated in allocation_rows:
        db.add(
            PaymentVoucherItem(
                voucher_id=voucher.id,
                expense_id=expense.id,
                gross_amount=gross,
                withholding_tax=wht,
                net_amount=net,
            )
        )

        previous_items = db.scalars(
            select(PaymentVoucherItem).where(PaymentVoucherItem.expense_id == expense.id, PaymentVoucherItem.voucher_id != voucher.id)
        ).all()
        if previous_items:
            baseline_gross = sum((Decimal(item.gross_amount or 0) for item in previous_items), Decimal("0"))
            baseline_wht = sum((Decimal(item.withholding_tax or 0) for item in previous_items), Decimal("0"))
            baseline_net = sum((Decimal(item.net_amount or 0) for item in previous_items), Decimal("0"))
        else:
            baseline_wht = Decimal(expense.withholding_tax or 0)
            baseline_net = Decimal(expense.net_paid or 0)
            baseline_gross = min(Decimal(expense.total_amount or 0), baseline_wht + baseline_net)

        cumulative_gross = baseline_gross + gross
        cumulative_wht = baseline_wht + wht
        cumulative_net = baseline_net + net

        expense.withholding_tax = cumulative_wht
        expense.net_paid = cumulative_net
        expense.payment_method = payload.payment_method
        expense.payment_status = "PAID" if cumulative_gross >= Decimal(expense.total_amount or 0) - Decimal(expense.canceled_amount or 0) - Decimal("0.01") else "PARTIAL"
        expense.updated_at = datetime.utcnow()

    add_audit(
        db,
        "payment_voucher",
        voucher.id,
        "CREATE",
        {
            "voucher_no": voucher.voucher_no,
            "allocations": [
                {
                    "expense_id": expense.id,
                    "gross_amount": str(gross),
                    "withholding_tax": str(wht),
                    "net_amount": str(net),
                }
                for expense, gross, wht, net, _ in allocation_rows
            ],
            "gross_amount": str(gross_amount),
            "withholding_tax": str(withholding_tax),
            "net_amount": str(net_amount),
            "wht_certificate_no": voucher.wht_certificate_no,
            "cheque_no": voucher.cheque_no,
            "billing_note_no": voucher.billing_note_no,
        },
    )
    db.commit()
    db.refresh(voucher)
    return voucher


@router.put("/payment-vouchers/{voucher_id}/payment", response_model=PaymentVoucherOut)
def update_payment_voucher_payment(voucher_id: int, payload: PaymentVoucherPaymentUpdate, db: Session = Depends(get_db)):
    if len(payload.reason.strip()) < 3:
        raise HTTPException(status_code=400, detail="A meaningful reason is required")
    voucher = db.get(PaymentVoucher, voucher_id)
    if not voucher:
        raise HTTPException(status_code=404, detail="Payment voucher not found")
    if payload.payment_method == "CHEQUE" and (not payload.bank_name or not payload.cheque_no or not payload.cheque_date):
        raise HTTPException(status_code=400, detail="Cheque payment requires bank name, cheque number and cheque date")

    old = {"payment_method": voucher.payment_method, "cheque_no": voucher.cheque_no,
           "cheque_date": voucher.cheque_date, "bank_name": voucher.bank_name,
           "billing_note_no": voucher.billing_note_no, "notes": voucher.notes}
    voucher.payment_method = payload.payment_method
    voucher.cheque_no = payload.cheque_no if payload.payment_method == "CHEQUE" else None
    voucher.cheque_date = payload.cheque_date if payload.payment_method == "CHEQUE" else None
    voucher.bank_name = payload.bank_name if payload.payment_method == "CHEQUE" else None
    voucher.billing_note_no = payload.billing_note_no
    voucher.notes = payload.notes
    voucher.updated_at = datetime.utcnow()
    add_audit(db, "payment_voucher", voucher.id, "UPDATE_PAYMENT", {
        "old": old,
        "new": {"payment_method": voucher.payment_method, "cheque_no": voucher.cheque_no,
                "cheque_date": voucher.cheque_date, "bank_name": voucher.bank_name,
                "billing_note_no": voucher.billing_note_no, "notes": voucher.notes},
        "reason": payload.reason.strip(),
    })
    db.commit()
    db.refresh(voucher)
    return voucher


@router.put("/payment-vouchers/{voucher_id}/adjustment", response_model=PaymentVoucherOut)
def adjust_payment_voucher(voucher_id: int, payload: PaymentVoucherAdjustment, db: Session = Depends(get_db)):
    """Revise one issued PV and its expense balances in a single transaction."""
    if len(payload.reason.strip()) < 3:
        raise HTTPException(status_code=400, detail="A meaningful reason is required")
    cent = Decimal("0.01")

    def amount(value: Decimal) -> Decimal:
        value = Decimal(value)
        if not value.is_finite():
            raise HTTPException(status_code=400, detail="Invalid monetary amount")
        return value.quantize(cent, rounding=ROUND_HALF_UP)

    voucher = db.scalar(select(PaymentVoucher).where(PaymentVoucher.id == voucher_id).with_for_update())
    if not voucher:
        raise HTTPException(status_code=404, detail="Payment voucher not found")
    if voucher.status != "ISSUED":
        raise HTTPException(status_code=409, detail="Only issued vouchers can be revised")

    old_items = list(voucher.items)
    old_ids = {item.expense_id for item in old_items}
    if len(old_ids) != len(old_items):
        raise HTTPException(status_code=409, detail="Existing voucher has duplicate allocations")
    proposed = {}
    for row in payload.allocations:
        if row.expense_id in proposed:
            raise HTTPException(status_code=400, detail="Duplicate expense allocation")
        gross, wht, canceled = amount(row.gross_amount), amount(row.withholding_tax), amount(row.canceled_amount)
        if gross <= 0 or wht < 0 or wht > gross or canceled < 0:
            raise HTTPException(status_code=400, detail="Invalid allocation amounts")
        proposed[row.expense_id] = (gross, wht, canceled)

    affected_ids = old_ids | set(proposed)
    expenses = db.scalars(select(Expense).where(Expense.id.in_(affected_ids)).order_by(Expense.id).with_for_update()).all()
    if len(expenses) != len(affected_ids):
        raise HTTPException(status_code=404, detail="One or more expenses were not found")
    expense_map = {expense.id: expense for expense in expenses}
    if any(expense.payment_status == "VOID" or expense.project_id != voucher.project_id or expense.vendor_id != voucher.vendor_id for expense in expenses):
        raise HTTPException(status_code=400, detail="Expense project/vendor mismatch or voided expense")

    all_items = db.scalars(select(PaymentVoucherItem).where(PaymentVoucherItem.expense_id.in_(affected_ids)).with_for_update()).all()
    by_expense = {expense_id: [] for expense_id in affected_ids}
    for item in all_items:
        by_expense[item.expense_id].append(item)

    baselines = {}
    old_balances = {}
    for expense in expenses:
        old_balances[expense.id] = {"expense_no": expense.expense_no, "invoice_total": str(expense.total_amount),
                                    "canceled_amount": str(expense.canceled_amount), "net_paid": str(expense.net_paid),
                                    "withholding_tax": str(expense.withholding_tax), "status": expense.payment_status}
        existing = by_expense[expense.id]
        item_net = sum((Decimal(item.net_amount or 0) for item in existing), Decimal("0"))
        item_wht = sum((Decimal(item.withholding_tax or 0) for item in existing), Decimal("0"))
        item_canceled = sum((Decimal(item.canceled_amount or 0) for item in existing), Decimal("0"))
        manual_net = max(Decimal(expense.net_paid or 0) - item_net, Decimal("0"))
        manual_wht = max(Decimal(expense.withholding_tax or 0) - item_wht, Decimal("0"))
        manual_canceled = max(Decimal(expense.canceled_amount or 0) - item_canceled, Decimal("0"))
        baselines[expense.id] = (manual_net, manual_wht, manual_canceled)
        others = [item for item in existing if item.voucher_id != voucher.id]
        proposed_gross, _, proposed_canceled = proposed.get(expense.id, (Decimal("0"), Decimal("0"), Decimal("0")))
        committed = manual_net + manual_wht + manual_canceled + sum(
            (Decimal(item.gross_amount or 0) + Decimal(item.canceled_amount or 0) for item in others), Decimal("0")
        )
        if committed + proposed_gross + proposed_canceled > Decimal(expense.total_amount or 0):
            raise HTTPException(status_code=400, detail=f"Allocation exceeds accepted balance for {expense.expense_no}")

    new_gross = sum((row[0] for row in proposed.values()), Decimal("0"))
    new_wht = sum((row[1] for row in proposed.values()), Decimal("0"))
    new_canceled = sum((row[2] for row in proposed.values()), Decimal("0"))
    old_snapshot = {
        "voucher_no": voucher.voucher_no,
        "gross_amount": str(voucher.gross_amount), "withholding_tax": str(voucher.withholding_tax),
        "net_amount": str(voucher.net_amount), "canceled_amount": str(voucher.canceled_amount),
        "payment_date": voucher.payment_date, "wht_issue_date": voucher.wht_issue_date,
        "wht_certificate_no": voucher.wht_certificate_no,
        "allocations": [{"expense_id": item.expense_id, "gross_amount": str(item.gross_amount),
                         "withholding_tax": str(item.withholding_tax), "canceled_amount": str(item.canceled_amount)} for item in old_items],
    }
    if voucher.wht_certificate_no and new_wht == 0:
        raise HTTPException(status_code=409, detail="Issued WHT certificate cannot be silently removed; reconcile tax first")

    old_by_expense = {item.expense_id: item for item in old_items}
    for expense_id, (gross, wht, canceled) in proposed.items():
        item = old_by_expense.pop(expense_id, None)
        if item is None:
            item = PaymentVoucherItem(voucher_id=voucher.id, expense_id=expense_id)
            db.add(item)
        item.gross_amount = gross
        item.withholding_tax = wht
        item.net_amount = gross - wht
        item.canceled_amount = canceled
    for item in old_by_expense.values():
        db.delete(item)
    db.flush()

    voucher.expense_id = next(iter(proposed))
    voucher.gross_amount = new_gross
    voucher.withholding_tax = new_wht
    voucher.net_amount = new_gross - new_wht
    voucher.canceled_amount = new_canceled
    voucher.payment_date = payload.payment_date
    voucher.wht_issue_date = (payload.wht_issue_date or payload.payment_date) if new_wht > 0 else None
    voucher.adjustment_reason = payload.reason.strip()
    if new_wht > 0 and not voucher.wht_certificate_no:
        voucher.wht_certificate_no = next_wht_no(db, payload.payment_date)
    tax_base = sum(
        (gross * Decimal(expense_map[expense_id].subtotal or 0) / Decimal(expense_map[expense_id].total_amount or 1)
         for expense_id, (gross, _, _) in proposed.items()), Decimal("0")
    )
    voucher.wht_rate = (new_wht / tax_base * 100).quantize(cent, rounding=ROUND_HALF_UP) if tax_base else Decimal("0")
    voucher.updated_at = datetime.utcnow()

    for expense in expenses:
        manual_net, manual_wht, manual_canceled = baselines[expense.id]
        current = db.scalars(select(PaymentVoucherItem).where(PaymentVoucherItem.expense_id == expense.id)).all()
        gross = manual_net + manual_wht + sum((Decimal(item.gross_amount or 0) for item in current), Decimal("0"))
        expense.net_paid = manual_net + sum((Decimal(item.net_amount or 0) for item in current), Decimal("0"))
        expense.withholding_tax = manual_wht + sum((Decimal(item.withholding_tax or 0) for item in current), Decimal("0"))
        expense.canceled_amount = manual_canceled + sum((Decimal(item.canceled_amount or 0) for item in current), Decimal("0"))
        accepted = Decimal(expense.total_amount or 0) - expense.canceled_amount
        expense.payment_status = "PAID" if gross >= accepted else ("PARTIAL" if gross > 0 else "UNPAID")
        expense.updated_at = datetime.utcnow()

    new_snapshot = {
        "voucher_no": voucher.voucher_no,
        "gross_amount": str(voucher.gross_amount), "withholding_tax": str(voucher.withholding_tax),
        "net_amount": str(voucher.net_amount), "canceled_amount": str(voucher.canceled_amount),
        "payment_date": voucher.payment_date, "wht_issue_date": voucher.wht_issue_date,
        "wht_certificate_no": voucher.wht_certificate_no,
        "allocations": [{"expense_id": expense_id, "gross_amount": str(gross), "withholding_tax": str(wht),
                         "canceled_amount": str(canceled)} for expense_id, (gross, wht, canceled) in proposed.items()],
    }
    add_audit(db, "payment_voucher", voucher.id, "ADJUST", {
        "old": old_snapshot, "new": new_snapshot, "reason": payload.reason.strip(),
        "expense_balances": {expense.id: {"old": old_balances[expense.id],
                          "new": {"invoice_total": str(expense.total_amount), "canceled_amount": str(expense.canceled_amount),
                                  "net_paid": str(expense.net_paid), "withholding_tax": str(expense.withholding_tax),
                                  "status": expense.payment_status}} for expense in expenses},
        "tax_reconciliation_required": bool(old_snapshot["wht_certificate_no"] and old_snapshot != new_snapshot),
    })
    db.commit()
    db.refresh(voucher)
    return voucher


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
    canceled = sum((Decimal(e.canceled_amount or 0) for e in expenses), Decimal("0"))
    paid = sum((Decimal(e.net_paid or 0) for e in expenses), Decimal("0"))
    withholding = sum((Decimal(e.withholding_tax or 0) for e in expenses), Decimal("0"))
    outstanding = sum((expense_outstanding(e) for e in expenses), Decimal("0"))
    unpaid_count = sum(1 for e in expenses if e.payment_status in {"UNPAID", "PARTIAL"})

    return DashboardSummary(
        project_id=project.id,
        project_name=project.name,
        total_expenses=total,
        canceled_amount=canceled,
        accepted_expenses=total - canceled,
        paid_amount=paid,
        withholding_tax=withholding,
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
        canceled = sum((Decimal(e.canceled_amount or 0) for e in items), Decimal("0"))
        payable = sum(
            (max(Decimal(e.total_amount or 0) - Decimal(e.canceled_amount or 0) - Decimal(e.withholding_tax or 0), Decimal("0")) for e in items),
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
                canceled_amount=canceled,
                accepted_amount=total - canceled,
                vendor_payable=payable,
                paid_amount=paid,
                outstanding_amount=sum((expense_outstanding(e) for e in items), Decimal("0")),
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
        "Canceled Amount",
        "Accepted Amount",
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
            expense.canceled_amount,
            Decimal(expense.total_amount or 0) - Decimal(expense.canceled_amount or 0),
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
