# Vela Construction Expense — V1 foundation

## Seed project
- Code: SEA-MOUNTAIN
- Name: Sea Mountain
- Status: ACTIVE

## V1 entities
- Project
- CostCode
- Vendor
- Expense

## Expense status policy
- UNPAID
- PARTIAL
- PAID
- VOID

## Expense numbering
EXP-YYYY-00001

## Important design decisions
1. Separate database and deployment from SmartHR.
2. Expenses always belong to a project and a cost code.
3. Original document is referenced by Paperless document ID; accounting fields stay in Vela Construction Expense.
4. Do not put full accounting GL logic into V1.
5. Future modules must fit without schema reset: budgets, purchase orders, contractor progress claims, approvals, payment batches, retention, audit log.

## Next implementation milestone
- Authentication + roles
- Vendor CRUD
- Expense create/edit UI
- Paperless upload/OCR review flow
- Dashboard totals
- Excel/PDF export
