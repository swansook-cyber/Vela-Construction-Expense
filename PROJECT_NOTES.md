# Vela Construction Expense

## Current milestone: V0.2 operational expense entry

Project: **Sea Mountain** (`SEA-MOUNTAIN`)

### Implemented
- Standalone PostgreSQL database and Docker deployment
- FastAPI backend
- React/Vite mobile-first frontend
- Sea Mountain seed project
- 10 construction Cost Codes
- Vendor / contractor create, list, update and safe-delete API
- Expense entry with Project + Cost Code required
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
- Nginx reverse proxy from frontend `/api` to backend
- Paperless-ngx connector shell

### Accounting interpretation in V0.2
`total_amount = subtotal + VAT`

`vendor_payable = total_amount - withholding_tax`

`outstanding_vendor_payable = vendor_payable - net_paid`

Withholding tax is therefore **not shown as an outstanding amount owed to the vendor**. It remains part of the document/tax record and can later be handled in the tax/reporting module.

### Guardrails
- SmartHR is not shared or imported.
- Expense must belong to a Project and Cost Code.
- Linked Vendor cannot be deleted.
- Negative monetary values are rejected.
- Paid amount cannot exceed document total.
- Full GL accounting is intentionally outside V1.

### Next milestone: V0.3 Documents
1. Paperless-ngx deployment/integration
2. Upload receipt/invoice from phone
3. OCR metadata review
4. Link Paperless document ID to expense
5. Document status / missing-document report
6. Expense edit/void workflow + audit trail
7. Excel/PDF project reports
