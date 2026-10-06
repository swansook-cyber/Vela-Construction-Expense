import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any


THAI_COMPANY_MARKERS = ("บริษัท", "หจก.", "ห้างหุ้นส่วน", "จำกัด", "ร้าน")
TOTAL_LABELS = ("ยอดรวม", "รวมทั้งสิ้น", "จำนวนเงินรวม", "grand total", "total")
SUBTOTAL_LABELS = ("ก่อน vat", "มูลค่าสินค้า", "subtotal", "ก่อนภาษี")
VAT_LABELS = ("vat", "ภาษีมูลค่าเพิ่ม")
BAD_DOCUMENT_TOKENS = {"copy", "original", "customer", "taxinvoice", "invoice"}


def _clean_line(value: str) -> str:
    return " ".join(value.replace("\u200b", " ").split())


def _money(value: str) -> str | None:
    cleaned = value.replace(",", "").replace("฿", "").strip()
    try:
        return f"{Decimal(cleaned):.2f}"
    except (InvalidOperation, ValueError):
        return None


def _looks_like_money_token(token: str, line: str) -> bool:
    normalized = token.replace(",", "")
    # Reject obvious percentages / isolated single-digit noise such as "5" from "VAT 5%".
    if re.search(rf"{re.escape(token)}\s*%", line):
        return False
    if "." in normalized:
        return True
    digits = re.sub(r"\D", "", normalized)
    return len(digits) >= 3


def _find_amount_near(lines: list[str], labels: tuple[str, ...]) -> str | None:
    amount_re = re.compile(r"(?<!\d)(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|\d+(?:\.\d{1,2}))(?!\d)")
    for line in reversed(lines):
        low = line.lower()
        if any(label in low for label in labels):
            values = amount_re.findall(line)
            for value in reversed(values):
                if _looks_like_money_token(value, line):
                    return _money(value)
    return None


def _parse_date(text: str) -> str | None:
    patterns = [
        r"(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?!\d)",
        r"(?<!\d)(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})(?!\d)",
    ]
    for pattern in patterns:
        for day_s, month_s, year_s in re.findall(pattern, text):
            day, month, year = int(day_s), int(month_s), int(year_s)
            if len(year_s) == 2:
                year += 2500 if year >= 50 else 2000
            if year >= 2400:
                year -= 543
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                continue
    return None


def _vendor_candidate(lines: list[str]) -> str | None:
    # Be conservative: only suggest lines that actually look like a business name.
    for line in lines[:25]:
        if any(marker in line for marker in THAI_COMPANY_MARKERS):
            if 6 <= len(line) <= 160:
                return line[:255]
    return None


def _document_candidate(compact: str) -> str | None:
    doc_patterns = [
        r"(?:เลขที่|เลขที่เอกสาร|invoice\s*(?:no\.?|#)?|inv\.?\s*(?:no\.?)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{2,})",
        r"(?:ใบกำกับภาษี|ใบส่งของ)\s*(?:เลขที่)?\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{3,})",
    ]
    for pattern in doc_patterns:
        match = re.search(pattern, compact, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1).strip().strip("-_/")
        if candidate.lower().replace(" ", "") in BAD_DOCUMENT_TOKENS:
            continue
        # Require at least one digit; avoids OCR words like COPY.
        if not re.search(r"\d", candidate):
            continue
        return candidate[:100]
    return None


def analyze_ocr_document(document: dict[str, Any]) -> dict[str, Any]:
    content = str(document.get("content") or "")
    lines = [_clean_line(line) for line in content.splitlines() if _clean_line(line)]

    compact = re.sub(r"\s+", " ", content)
    tax_id_match = re.search(r"(?<!\d)(\d{13})(?!\d)", compact)
    tax_id = tax_id_match.group(1) if tax_id_match else None

    vendor_name = _vendor_candidate(lines)
    document_no = _document_candidate(compact)
    subtotal = _find_amount_near(lines, SUBTOTAL_LABELS)
    vat = _find_amount_near(lines, VAT_LABELS)
    total = _find_amount_near(lines, TOTAL_LABELS)

    confidence_notes: list[str] = []
    if not vendor_name:
        confidence_notes.append("ไม่พบชื่อผู้ขายที่มั่นใจ")
    if not total:
        confidence_notes.append("ไม่พบยอดรวมที่มั่นใจ")
    if not tax_id:
        confidence_notes.append("ไม่พบเลขผู้เสียภาษี 13 หลัก")
    if not document_no:
        confidence_notes.append("ไม่พบเลขที่เอกสารที่มั่นใจ")
    if not subtotal:
        confidence_notes.append("ไม่พบยอดก่อน VAT ที่มั่นใจ")
    if not vat:
        confidence_notes.append("ไม่พบยอด VAT ที่มั่นใจ")

    return {
        "paperless_document_id": document.get("id"),
        "title": document.get("title"),
        "created": document.get("created"),
        "suggested": {
            "vendor_name": vendor_name,
            "tax_id": tax_id,
            "expense_date": _parse_date(content),
            "document_no": document_no,
            "subtotal": subtotal,
            "vat_amount": vat,
            "total_amount": total,
        },
        "confidence_notes": confidence_notes,
        "ocr_text": content,
        "requires_review": True,
    }
