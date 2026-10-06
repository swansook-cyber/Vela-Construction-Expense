# Vela Construction Expense

## Current milestone: V0.3 expense lifecycle + documents + reporting

Project: **Sea Mountain** (`SEA-MOUNTAIN`)

### Implemented
- Standalone PostgreSQL database and Docker deployment
- FastAPI backend
- React/Vite mobile-first frontend
- Sea Mountain seed project
- 10 construction Cost Codes
- Vendor / contractor CRUD
- Expense create + edit
- Expense void workflow with required reason; no destructive delete
- VAT 0% / 7%
- Withholding tax 0% / 1% / 3% / 5%
- Payment status: UNPAID / PARTIAL / PAID / VOID
- Payment methods: transfer / cash / credit / cheque
- Project dashboard:
  - document expense total
  - amount paid to vendors
  - outstanding vendor payable
  - unpaid/partial item count
- Expense history table
- Alembic database migrations
- Audit Log for vendor/expense lifecycle
- Paperless-ngx deployment stack
- Paperless PDF/JPG/PNG/WEBP upload
- OCR task ID stored against an Expense
- OCR task polling with automatic Paperless document ID linking when the task payload exposes it
- Manual Paperless document link API
- Cost Code summary report
- UTF-8 BOM CSV expense export for Excel
- GitHub Actions CI for backend syntax, frontend build, and Docker Compose validation

### Accounting interpretation
`document_total = subtotal + VAT`

`vendor_payable = document_total - withholding_tax`

`outstanding_vendor_payable = vendor_payable - net_paid`

Withholding tax remains in the expense/tax record but is not shown as money still owed to the vendor.

### Guardrails
- SmartHR is completely separate.
- Expense must belong to Project + Cost Code.
- Linked Vendor cannot be deleted.
- Negative monetary values are rejected.
- Paid amount cannot exceed vendor payable after WHT.
- A voided expense cannot be edited or receive a new document.
- Expense cancellation is recorded via VOID + reason, not hard delete.
- Full GL accounting remains outside V1.

### Deployment gate
Before adding Budget / PO / contractor progress claims:
1. GitHub CI must pass.
2. Deploy current main branch to Home Hub.
3. Confirm Alembic migrations run cleanly on PostgreSQL.
4. Create first Paperless admin/token.
5. Test one real Sea Mountain expense with a real invoice/receipt.
6. Verify Thai OCR and document linkage.
7. Verify CSV output opens correctly in Excel.

### Next milestone after deployment QA: V0.4
- Authentication + roles
- Real actor identity in Audit Log
- Budget vs Actual by Cost Code
- Purchase Order
- Contractor progress claims
- Retention / advance / deductions
- PDF management report
