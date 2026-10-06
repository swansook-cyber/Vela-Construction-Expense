from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import CostCode, Project

DEFAULT_COST_CODES = [
    ("01", "งานเตรียมพื้นที่"),
    ("02", "งานโครงสร้าง"),
    ("03", "งานสถาปัตย์"),
    ("04", "งานไฟฟ้า"),
    ("05", "งานประปาและสุขาภิบาล"),
    ("06", "ระบบปรับอากาศและระบายอากาศ"),
    ("07", "เฟอร์นิเจอร์และอุปกรณ์"),
    ("08", "ค่าแรง"),
    ("09", "ผู้รับเหมา"),
    ("10", "ค่าใช้จ่ายสำนักงานโครงการ"),
]


def seed_defaults(db: Session) -> None:
    project = db.scalar(select(Project).where(Project.code == "SEA-MOUNTAIN"))
    if not project:
        db.add(Project(code="SEA-MOUNTAIN", name="Sea Mountain", status="ACTIVE"))

    for code, name in DEFAULT_COST_CODES:
        existing = db.scalar(select(CostCode).where(CostCode.code == code))
        if not existing:
            db.add(CostCode(code=code, name=name))

    db.commit()
