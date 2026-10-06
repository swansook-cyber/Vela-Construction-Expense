# Vela Construction Expense

Standalone construction expense and document management system.

## Initial project
- Project code: `SEA-MOUNTAIN`
- Project name: **Sea Mountain**

## Current status
V0.2 expense workflow + V0.3 document/OCR foundation.

### Working modules
- Sea Mountain project dashboard
- Construction Cost Codes
- Vendor / contractor master
- Expense entry
- VAT and withholding tax
- Payment status / method
- Expense history
- PostgreSQL + Alembic migrations
- Paperless-ngx document upload API/UI foundation

## Architecture
- Frontend: React + Vite + Nginx
- Backend: FastAPI + SQLAlchemy + Alembic
- Expense database: PostgreSQL
- Document/OCR engine: Paperless-ngx
- Paperless database: separate PostgreSQL
- Paperless task broker: Redis

SmartHR is not shared or imported.

## First deployment

Copy the environment template and replace all passwords/secrets before starting:

```bash
cp .env.example .env
nano .env
docker compose up -d --build
```

Services:
- Vela Construction Expense: http://SERVER:8097
- Backend health: http://SERVER:8098/health
- Paperless-ngx admin UI: http://SERVER:8099

Paperless will ask for its first administrator during initial setup. After login, generate an API token from the Paperless user profile and put it in:

```env
PAPERLESS_TOKEN=your_token_here
```

Then restart only the Vela backend:

```bash
docker compose restart backend
```

The **เอกสาร / OCR** tab in Vela will then show Paperless as connected.

## Accounting rules in current version

```
document total = subtotal + VAT
vendor payable = document total - withholding tax
outstanding vendor payable = vendor payable - amount paid
```

Withholding tax is kept as part of the expense/tax record but is not treated as money still owed to the vendor.

## OCR defaults
- Thai OCR language installed: `tha`
- Default OCR: `tha+eng`
- Timezone: `Asia/Bangkok`

## Next
- Associate asynchronous Paperless OCR result with Expense automatically
- Expense edit / void workflow
- Audit log
- Excel/PDF project reports
- Budget vs actual
- PO / contractor progress claims
