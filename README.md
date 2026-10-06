# Vela Construction Expense

Standalone construction expense and document management system.

## Initial project
- Project code: SEA-MOUNTAIN
- Project name: Sea Mountain

## V1 goals
- Separate from SmartHR (database, users, backups, business logic)
- Track projects, cost codes, vendors, expenses, payments, and documents
- Store links/metadata for Paperless-ngx documents
- Mobile-first expense capture workflow
- Export-ready reporting foundation

## Stack
- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Frontend: React + Vite
- Deployment: Docker Compose
- Document/OCR engine: Paperless-ngx via API integration (phase 1 connector shell)

## Run
```bash
docker compose up --build
```

Backend health: http://localhost:8098/health
Frontend: http://localhost:8097

## Core workflow
1. Upload/capture document
2. OCR/document metadata from Paperless-ngx
3. Select Project
4. Select Cost Code
5. Select/Create Vendor
6. Review totals, VAT, withholding tax, payment status
7. Save expense
8. Export/report
