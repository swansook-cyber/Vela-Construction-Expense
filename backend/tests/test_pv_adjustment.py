import json
import csv
import io
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import get_db
from app.core.database import Base
from app.main import app
from app.models.entities import AuditLog, CostCode, Expense, PaymentVoucher, Project, Vendor


@pytest.fixture
def context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)

    def db_override():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    with sessions() as db:
        db.add_all([Project(id=1, code="SEA", name="Sea Mountain"), CostCode(id=1, code="C01", name="งานบริการ"),
                    Vendor(id=1, name="Vendor A", entity_type="INDIVIDUAL"), Vendor(id=2, name="Vendor B")])
        db.commit()
    yield TestClient(app), sessions
    app.dependency_overrides.clear()
    engine.dispose()


def seed_expense(sessions, expense_id, total="1800.00", vendor_id=1, cost_code_id=1, expense_date=date(2026, 11, 10)):
    with sessions() as db:
        db.add(Expense(id=expense_id, expense_no=f"EXP-2026-{expense_id:05}", project_id=1, cost_code_id=cost_code_id,
                       vendor_id=vendor_id, expense_date=expense_date, document_no=f"INV-{expense_id}",
                       description="ค่าบริการ", subtotal=Decimal(total), vat_amount=Decimal("0"),
                       withholding_tax=Decimal("0"), total_amount=Decimal(total), canceled_amount=Decimal("0"),
                       net_paid=Decimal("0"), payment_status="UNPAID", paperless_document_id=77))
        db.commit()


def create_voucher(client, allocations, payment_date="2026-11-11", wht_issue_date=None, cheque_date=None):
    gross = sum(Decimal(row["gross_amount"]) for row in allocations)
    wht = sum(Decimal(row.get("withholding_tax", "0")) for row in allocations)
    payload = {"project_id": 1, "vendor_id": 1, "voucher_date": "2026-11-10",
               "payment_date": payment_date, "wht_issue_date": wht_issue_date,
               "gross_amount": str(gross), "withholding_tax": str(wht), "net_amount": str(gross-wht),
               "payment_method": "CHEQUE" if cheque_date else "TRANSFER", "payee_name": "Vendor A",
               "cheque_no": "CH-1" if cheque_date else None, "cheque_date": cheque_date,
               "bank_name": "SCB" if cheque_date else None, "allocations": allocations}
    response = client.post("/api/v1/payment-vouchers", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def adjust(client, voucher_id, allocations, **values):
    payload = {"allocations": allocations, "payment_date": "2026-11-12", "wht_issue_date": "2026-11-15",
               "reason": "รับสินค้าจริงน้อยกว่าบิล พร้อมใบตรวจรับ"}
    payload.update(values)
    return client.put(f"/api/v1/payment-vouchers/{voucher_id}/adjustment", json=payload)


def test_1800_to_1600_preserves_invoice_and_clears_outstanding(context):
    client, sessions = context
    seed_expense(sessions, 1)
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "1800.00", "withholding_tax": "0"}])
    result = adjust(client, voucher["id"], [{"expense_id": 1, "gross_amount": "1600.00", "withholding_tax": "0", "canceled_amount": "200.00"}])
    assert result.status_code == 200, result.text
    assert result.json()["voucher_no"] == voucher["voucher_no"]
    assert Decimal(result.json()["gross_amount"]) == 1600
    assert Decimal(result.json()["canceled_amount"]) == 200
    with sessions() as db:
        expense = db.get(Expense, 1)
        assert (expense.total_amount, expense.canceled_amount, expense.net_paid) == (1800, 200, 1600)
        assert expense.document_no == "INV-1" and expense.paperless_document_id == 77
        assert expense.payment_status == "PAID"
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "ADJUST"))
        details = json.loads(audit.details)
        assert details["old"]["gross_amount"] == "1800.00"
        assert details["new"]["canceled_amount"] == "200.00"
        assert details["reason"] and audit.created_at
    dashboard = client.get("/api/v1/dashboard/1").json()
    assert Decimal(dashboard["outstanding_amount"]) == 0
    assert Decimal(dashboard["total_expenses"]) == 1800
    assert Decimal(dashboard["canceled_amount"]) == 200
    assert Decimal(dashboard["accepted_expenses"]) == 1600
    report = client.get("/api/v1/reports/1/cost-codes").json()
    assert Decimal(report[0]["outstanding_amount"]) == 0
    assert (Decimal(report[0]["total_amount"]), Decimal(report[0]["canceled_amount"]),
            Decimal(report[0]["accepted_amount"])) == (1800, 200, 1600)


def test_dashboard_cost_codes_and_csv_reconcile_original_cancel_accepted(context):
    client, sessions = context
    with sessions() as db:
        db.add(CostCode(id=2, code="C02", name="งานวัสดุ"))
        db.commit()
    seed_expense(sessions, 1)
    seed_expense(sessions, 2, total="1000.00", cost_code_id=2, expense_date=date(2026, 10, 10))
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "1800.00", "withholding_tax": "0"}])
    response = adjust(client, voucher["id"], [{"expense_id": 1, "gross_amount": "1600.00",
                                               "withholding_tax": "0", "canceled_amount": "200.00"}])
    assert response.status_code == 200, response.text
    dashboard = client.get("/api/v1/dashboard/1").json()
    assert (Decimal(dashboard["total_expenses"]), Decimal(dashboard["canceled_amount"]),
            Decimal(dashboard["accepted_expenses"]), Decimal(dashboard["outstanding_amount"])) == (2800, 200, 2600, 1000)
    rows = client.get("/api/v1/reports/1/cost-codes").json()
    by_code = {row["code"]: row for row in rows}
    assert (Decimal(by_code["C01"]["total_amount"]), Decimal(by_code["C01"]["canceled_amount"]),
            Decimal(by_code["C01"]["accepted_amount"])) == (1800, 200, 1600)
    assert (Decimal(by_code["C02"]["total_amount"]), Decimal(by_code["C02"]["canceled_amount"]),
            Decimal(by_code["C02"]["accepted_amount"])) == (1000, 0, 1000)
    exported = list(csv.DictReader(io.StringIO(client.get("/api/v1/reports/1/expenses.csv").text.lstrip("\ufeff"))))
    by_document = {row["Document No"]: row for row in exported}
    assert by_document["INV-1"]["Document Total"] == "1800.00"
    assert by_document["INV-1"]["Canceled Amount"] == "200.00"
    assert by_document["INV-1"]["Accepted Amount"] == "1600.00"
    assert by_document["INV-2"]["Accepted Amount"] == "1000.00"


def test_installments_and_other_vouchers_are_unchanged(context):
    client, sessions = context
    seed_expense(sessions, 1)
    seed_expense(sessions, 2, total="500.00")
    first = create_voucher(client, [{"expense_id": 1, "gross_amount": "800.00", "withholding_tax": "0"}])
    second = create_voucher(client, [{"expense_id": 1, "gross_amount": "1000.00", "withholding_tax": "0"},
                                     {"expense_id": 2, "gross_amount": "500.00", "withholding_tax": "0"}])
    result = adjust(client, second["id"], [{"expense_id": 1, "gross_amount": "800.00", "withholding_tax": "0", "canceled_amount": "200.00"},
                                           {"expense_id": 2, "gross_amount": "500.00", "withholding_tax": "0"}])
    assert result.status_code == 200, result.text
    with sessions() as db:
        assert db.get(PaymentVoucher, first["id"]).gross_amount == 800
        assert db.get(Expense, 1).net_paid == 1600
        assert db.get(Expense, 1).canceled_amount == 200
        assert db.get(Expense, 2).net_paid == 500
    over = create_voucher_over(client, 1)
    assert over.status_code == 400


def create_voucher_over(client, expense_id):
    return client.post("/api/v1/payment-vouchers", json={"project_id": 1, "vendor_id": 1,
        "voucher_date": "2026-11-16", "gross_amount": "1.00", "withholding_tax": "0", "net_amount": "1.00",
        "payee_name": "Vendor A", "allocations": [{"expense_id": expense_id, "gross_amount": "1.00"}]})


def test_reject_duplicate_negative_overpayment_and_cross_vendor_atomically(context):
    client, sessions = context
    seed_expense(sessions, 1)
    seed_expense(sessions, 2, vendor_id=2)
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "800.00", "withholding_tax": "0"}])
    base = {"expense_id": 1, "gross_amount": "800.00", "withholding_tax": "0", "canceled_amount": "0"}
    bad_rows = [[base, base], [{**base, "canceled_amount": "-1"}],
                [{**base, "gross_amount": "1801.00"}],
                [base, {"expense_id": 2, "gross_amount": "1", "withholding_tax": "0"}]]
    for rows in bad_rows:
        result = adjust(client, voucher["id"], rows)
        assert result.status_code in (400, 422), result.text
    assert adjust(client, voucher["id"], [base], reason="   ").status_code == 400
    with sessions() as db:
        assert db.get(PaymentVoucher, voucher["id"]).gross_amount == 800
        assert db.get(Expense, 1).net_paid == 800
        assert db.scalar(select(AuditLog).where(AuditLog.action == "ADJUST")) is None


def test_cheque_payment_and_wht_dates_remain_independent_with_audit(context):
    client, sessions = context
    seed_expense(sessions, 1)
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "1000.00", "withholding_tax": "30.00"}],
                             payment_date="2026-11-11", cheque_date="2026-11-20")
    assert voucher["wht_issue_date"] == "2026-11-11"
    change_cheque = client.put(f"/api/v1/payment-vouchers/{voucher['id']}/payment", json={
        "payment_method": "CHEQUE", "bank_name": "SCB", "cheque_no": "CH-1", "cheque_date": "2026-11-25",
        "reason": "เลื่อนวันขึ้นเงินเช็ค"})
    assert change_cheque.status_code == 200, change_cheque.text
    assert change_cheque.json()["payment_date"] == "2026-11-11"
    assert change_cheque.json()["wht_issue_date"] == "2026-11-11"
    updated = adjust(client, voucher["id"], [{"expense_id": 1, "gross_amount": "1000.00", "withholding_tax": "30.00"}],
                     payment_date="2026-11-12", wht_issue_date="2026-11-15")
    assert updated.status_code == 200, updated.text
    assert updated.json()["cheque_date"] == "2026-11-25"
    assert updated.json()["payment_date"] == "2026-11-12"
    assert updated.json()["wht_issue_date"] == "2026-11-15"
    assert updated.json()["wht_certificate_no"] == voucher["wht_certificate_no"]
    with sessions() as db:
        logs = db.scalars(select(AuditLog).where(AuditLog.entity_id == voucher["id"]).order_by(AuditLog.id)).all()
        assert [log.action for log in logs] == ["CREATE", "UPDATE_PAYMENT", "ADJUST"]
        assert json.loads(logs[-1].details)["tax_reconciliation_required"] is True
        assert json.loads(logs[1].details)["old"]["cheque_date"] == "2026-11-20"


def test_wht_reduction_keeps_certificate_number_and_reconciles_expense(context):
    client, sessions = context
    seed_expense(sessions, 1)
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "1800.00", "withholding_tax": "54.00"}])
    result = adjust(client, voucher["id"], [{"expense_id": 1, "gross_amount": "1600.00",
                                              "withholding_tax": "48.00", "canceled_amount": "200.00"}])
    assert result.status_code == 200, result.text
    revised = result.json()
    assert revised["wht_certificate_no"] == voucher["wht_certificate_no"]
    assert Decimal(revised["net_amount"]) == 1552
    assert Decimal(revised["wht_rate"]) == 3
    with sessions() as db:
        expense = db.get(Expense, 1)
        assert (expense.total_amount, expense.canceled_amount, expense.withholding_tax, expense.net_paid) == (1800, 200, 48, 1552)
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "ADJUST"))
        details = json.loads(audit.details)
        assert details["tax_reconciliation_required"] is True
        assert details["expense_balances"]["1"]["old"]["withholding_tax"] == "54.00"
        assert details["expense_balances"]["1"]["new"]["withholding_tax"] == "48.00"
    dashboard = client.get("/api/v1/dashboard/1").json()
    assert (Decimal(dashboard["accepted_expenses"]), Decimal(dashboard["outstanding_amount"])) == (1600, 0)
    report = client.get("/api/v1/reports/1/cost-codes").json()[0]
    assert (Decimal(report["accepted_amount"]), Decimal(report["vendor_payable"]),
            Decimal(report["paid_amount"]), Decimal(report["outstanding_amount"])) == (1600, 1552, 1552, 0)


def test_removed_bill_returns_to_unpaid_without_touching_other_vouchers(context):
    client, sessions = context
    seed_expense(sessions, 1, total="500.00")
    seed_expense(sessions, 2, total="300.00")
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "500.00"},
                                     {"expense_id": 2, "gross_amount": "300.00"}])
    result = adjust(client, voucher["id"], [{"expense_id": 1, "gross_amount": "500.00"}])
    assert result.status_code == 200, result.text
    assert [row["expense_id"] for row in result.json()["allocations"]] == [1]
    with sessions() as db:
        expense = db.get(Expense, 2)
        assert expense.net_paid == 0 and expense.payment_status == "UNPAID"


def test_issued_certificate_cannot_be_silently_removed(context):
    client, sessions = context
    seed_expense(sessions, 1)
    voucher = create_voucher(client, [{"expense_id": 1, "gross_amount": "1000.00", "withholding_tax": "30.00"}])
    result = adjust(client, voucher["id"], [{"expense_id": 1, "gross_amount": "1000.00", "withholding_tax": "0"}])
    assert result.status_code == 409
    with sessions() as db:
        assert db.get(PaymentVoucher, voucher["id"]).withholding_tax == 30
        assert db.scalar(select(AuditLog).where(AuditLog.action == "ADJUST")) is None


def test_migration_adds_dates_and_cancellation_without_changing_old_rows(tmp_path, monkeypatch):
    from importlib import import_module
    from sqlalchemy import inspect
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration = import_module("migrations.versions.20261110_0011_pv_adjustment_dates")
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE expenses (id INTEGER PRIMARY KEY, total_amount NUMERIC(14,2))")
        connection.exec_driver_sql("CREATE TABLE payment_vouchers (id INTEGER PRIMARY KEY, voucher_date DATE)")
        connection.exec_driver_sql("CREATE TABLE payment_voucher_items (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO expenses (id, total_amount) VALUES (1, 1800)")
        connection.exec_driver_sql("INSERT INTO payment_vouchers (id, voucher_date) VALUES (1, '2026-11-10')")
        connection.exec_driver_sql("INSERT INTO payment_voucher_items (id) VALUES (1)")
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        assert connection.exec_driver_sql("SELECT total_amount, canceled_amount FROM expenses").one() == (1800, 0)
        assert connection.exec_driver_sql("SELECT payment_date, wht_issue_date FROM payment_vouchers").one() == ("2026-11-10", "2026-11-10")
        assert connection.exec_driver_sql("SELECT canceled_amount FROM payment_voucher_items").scalar_one() == 0
        assert "canceled_amount" in {column["name"] for column in inspect(connection).get_columns("expenses")}
        migration.downgrade()
        assert "canceled_amount" not in {column["name"] for column in inspect(connection).get_columns("expenses")}
    engine.dispose()
