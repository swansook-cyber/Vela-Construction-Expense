from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.api.routes import router
from app.core.database import Base, SessionLocal, engine
from app.services.seed import seed_defaults


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_defaults(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Vela Construction Expense API", version="0.1.0", lifespan=lifespan)
app.include_router(router)


@app.get("/health")
def health():
    return {"ok": True, "service": "vela-construction-expense", "version": "0.1.0"}
