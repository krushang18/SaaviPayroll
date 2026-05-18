from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import Optional, List
import math, os

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from sqlalchemy import create_engine, Column, String, Float, Integer, Index, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ── Database ──────────────────────────────────────────────────────────────────
_DB_URL = os.getenv("DATABASE_URL")
if not _DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")
# Render issues the legacy postgres:// scheme; SQLAlchemy requires postgresql://
if _DB_URL.startswith("postgres://"):
    _DB_URL = _DB_URL.replace("postgres://", "postgresql://", 1)

print(f"[DB] Connecting to PostgreSQL: {_DB_URL[:60]}...")

engine = create_engine(_DB_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── ORM Models ────────────────────────────────────────────────────────────────
class CategoryRow(Base):
    __tablename__ = "categories"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(String,  nullable=False, unique=True)
    night_base = Column(Float,   default=0)
    night_appr = Column(Float,   default=0)


class EmployeeRow(Base):
    __tablename__ = "employees"
    id           = Column(String,  primary_key=True)
    name         = Column(String,  nullable=False)
    monthly      = Column(Float,   nullable=False)
    hourly       = Column(Float,   nullable=False)
    working_days = Column(Integer, default=30)
    category     = Column(String,  nullable=True)


class PayrollRow(Base):
    __tablename__ = "payrolls"
    month          = Column(String, primary_key=True)
    from_date      = Column(String, nullable=False)
    to_date        = Column(String, nullable=False)
    comp_days      = Column(Integer, default=0)
    employee_count = Column(Integer, default=0)
    total_pay      = Column(Float,   default=0.0)
    saved_at       = Column(String)


class PayrollRecordRow(Base):
    __tablename__  = "payroll_records"
    __table_args__ = (Index("ix_pr_month", "payroll_month"),)
    id            = Column(Integer, primary_key=True, autoincrement=True)
    payroll_month = Column(String, nullable=False)
    emp_id        = Column(String, nullable=False)
    emp_name      = Column(String)
    monthly       = Column(Float)
    daily         = Column(Float)
    hourly        = Column(Float)
    working_days  = Column(Integer)
    period_days   = Column(Integer)
    present_days  = Column(Float)
    absent_days   = Column(Float)
    comp_days     = Column(Integer)
    extra_hours   = Column(Float)
    diff          = Column(Float)
    day_adj       = Column(Float)
    base_pay      = Column(Float)
    ot_pay        = Column(Float)
    debit_amount  = Column(Float)
    debit_hours   = Column(Float, default=0)
    debit_hrs_pay = Column(Float, default=0)
    night_shifts  = Column(Float, default=0)
    night_base    = Column(Float, default=0)
    night_appr    = Column(Float, default=0)
    night_pay     = Column(Float, default=0)
    total         = Column(Float)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE payroll_records ADD COLUMN debit_hours REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN debit_hrs_pay REAL DEFAULT 0",
            "ALTER TABLE employees ADD COLUMN category TEXT DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN night_shifts REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN night_base REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN night_appr REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN night_pay REAL DEFAULT 0",
        ]:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()
    yield


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Saavi Payroll API", version="3.0.0", lifespan=lifespan)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Serialisation helpers ─────────────────────────────────────────────────────
def _emp_dict(row: EmployeeRow) -> dict:
    return {
        "id":          row.id,
        "name":        row.name,
        "monthly":     row.monthly,
        "hourly":      row.hourly,
        "workingDays": row.working_days,
        "category":    row.category,
    }


def _emp_night_rates(row: EmployeeRow, db: Session):
    if row.category:
        cat = db.query(CategoryRow).filter(CategoryRow.name == row.category).first()
        if cat:
            return cat.night_base, cat.night_appr
    return 0.0, 0.0


def _record_dict(row: PayrollRecordRow) -> dict:
    return {
        "empId":       row.emp_id,
        "empName":     row.emp_name,
        "monthly":     row.monthly,
        "daily":       row.daily,
        "hourly":      row.hourly,
        "workingDays": row.working_days,
        "periodDays":  row.period_days,
        "presentDays": row.present_days,
        "absentDays":  row.absent_days,
        "compDays":    row.comp_days,
        "extraHours":  row.extra_hours,
        "diff":        row.diff,
        "dayAdj":      row.day_adj,
        "basePay":     row.base_pay,
        "otPay":       row.ot_pay,
        "debitAmount":  row.debit_amount,
        "debitHours":   row.debit_hours or 0,
        "debitHrsPay":  row.debit_hrs_pay or 0,
        "nightShifts":  row.night_shifts or 0,
        "nightBase":    row.night_base or 0,
        "nightAppr":    row.night_appr or 0,
        "nightPay":     row.night_pay or 0,
        "total":        row.total,
    }


def _payroll_dict(p: PayrollRow, records) -> dict:
    return {
        "month":         p.month,
        "fromDate":      p.from_date,
        "toDate":        p.to_date,
        "compDays":      p.comp_days,
        "employeeCount": p.employee_count,
        "totalPay":      p.total_pay,
        "records":       [_record_dict(r) for r in records],
        "savedAt":       p.saved_at,
    }


# ── Pydantic models ───────────────────────────────────────────────────────────
class Employee(BaseModel):
    id: str          = Field(min_length=1)
    name: str        = Field(min_length=1)
    monthly: float   = Field(ge=0)
    hourly: float    = Field(ge=0)
    workingDays: int = Field(default=30, ge=1, le=31)
    category: str    = Field(min_length=1)

    @field_validator('id', 'name', 'category', mode='before')
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator('id', 'name', 'category')
    @classmethod
    def _non_empty(cls, v):
        if not v:
            raise ValueError('must not be empty')
        return v


class CategoryIn(BaseModel):
    name: str        = Field(min_length=1)
    nightBase: float = Field(default=0, ge=0)
    nightAppr: float = Field(default=0, ge=0)

    @field_validator('name', mode='before')
    @classmethod
    def _strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator('name')
    @classmethod
    def _non_empty_name(cls, v):
        if not v:
            raise ValueError('must not be empty')
        return v


class PayrollEntry(BaseModel):
    empId: str
    presentDays: Optional[float] = None
    absentDays: Optional[float] = None
    extraHours: float  = Field(default=0, ge=0)
    debitHours: float  = Field(default=0, ge=0)
    debitAmount: float = Field(default=0, ge=0)
    nightShifts: float = Field(default=0, ge=0)


class PayrollIn(BaseModel):
    month: str                          # "2026-04"
    fromDate: str                       # "2026-03-26"
    toDate: str                         # "2026-04-25"
    entries: List[PayrollEntry] = Field(min_length=1)

    @model_validator(mode='after')
    def _check_dates(self):
        if self.fromDate > self.toDate:
            raise ValueError('fromDate must not be after toDate')
        pd = _period_days(self.fromDate, self.toDate)
        if pd < 28 or pd > 31:
            raise ValueError(f'Pay period must be 28–31 days (got {pd})')
        return self


# ── Payroll logic (exact mirror of frontend computeSalary) ────────────────────
#
# daily   = floor(monthly / 30)
# diff    = floor(present) - workingDays
# dayAdj  = diff * daily
# basePay = monthly + dayAdj
# otPay   = extraHours * hourly
# total   = basePay + otPay - debitAmount

def _period_days(from_date: str, to_date: str) -> int:
    d1 = date.fromisoformat(from_date)
    d2 = date.fromisoformat(to_date)
    return (d2 - d1).days + 1


def _calc_record(emp: dict, fromDate: str, toDate: str,
                 presentDays: Optional[float], absentDays: Optional[float],
                 extraHours: float, debitHours: float = 0, debitAmount: float = 0,
                 nightShifts: float = 0, nightBase: float = 0, nightAppr: float = 0) -> dict:
    pd = _period_days(fromDate, toDate)
    daily = math.floor(emp["monthly"] / 30)
    wd = emp.get("workingDays", 30)

    present = presentDays
    absent = absentDays

    if present is None and absent is None:
        raise ValueError(f"{emp['name']}: provide presentDays or absentDays")

    if present is None:
        present = pd - absent
    if absent is None:
        absent = pd - present

    present = math.floor(present)
    absent = math.floor(absent)

    if present < 0:
        raise ValueError(f"{emp['name']}: presentDays cannot be negative")

    # Months shorter than 30 days get free complementary days (salary is always /30)
    comp_days = max(0, 30 - pd)
    effective_present = present + comp_days

    diff = effective_present - wd
    dayAdj = diff * daily
    basePay = emp["monthly"] + dayAdj
    otPay = extraHours * emp["hourly"]
    debitHrsPay = debitHours * emp["hourly"]
    nightPay = nightShifts * (nightBase + nightAppr)
    total = basePay + otPay + nightPay - debitAmount - debitHrsPay

    return {
        "empId":       emp["id"],
        "empName":     emp["name"],
        "monthly":     emp["monthly"],
        "daily":       daily,
        "hourly":      emp["hourly"],
        "workingDays": wd,
        "periodDays":  pd,
        "presentDays": present,
        "absentDays":  absent,
        "compDays":    comp_days,
        "extraHours":  extraHours,
        "debitHours":  debitHours,
        "debitHrsPay": debitHrsPay,
        "nightShifts": nightShifts,
        "nightBase":   nightBase,
        "nightAppr":   nightAppr,
        "nightPay":    nightPay,
        "diff":        diff,
        "dayAdj":      dayAdj,
        "basePay":     basePay,
        "otPay":       otPay,
        "debitAmount": debitAmount,
        "total":       total,
    }


def _compute_payroll(payload: PayrollIn, db: Session) -> dict:
    records = []
    errors = []
    for entry in payload.entries:
        row = db.query(EmployeeRow).filter(EmployeeRow.id == entry.empId).first()
        if not row:
            errors.append(f"Employee {entry.empId} not found")
            continue
        emp = _emp_dict(row)
        night_base, night_appr = _emp_night_rates(row, db)
        try:
            rec = _calc_record(emp, payload.fromDate, payload.toDate,
                               entry.presentDays, entry.absentDays,
                               entry.extraHours, entry.debitHours, entry.debitAmount,
                               entry.nightShifts, night_base, night_appr)
            records.append(rec)
        except ValueError as e:
            errors.append(str(e))

    if errors:
        raise HTTPException(400, detail="; ".join(errors))

    comp_days = max(0, 30 - _period_days(payload.fromDate, payload.toDate))
    return {
        "month":         payload.month,
        "fromDate":      payload.fromDate,
        "toDate":        payload.toDate,
        "compDays":      comp_days,
        "employeeCount": len(records),
        "totalPay":      sum(r["total"] for r in records),
        "records":       records,
    }


def _persist_records(result: dict, db: Session):
    for rec in result["records"]:
        db.add(PayrollRecordRow(
            payroll_month=result["month"],
            emp_id=rec["empId"],
            emp_name=rec["empName"],
            monthly=rec["monthly"],
            daily=rec["daily"],
            hourly=rec["hourly"],
            working_days=rec["workingDays"],
            period_days=rec["periodDays"],
            present_days=rec["presentDays"],
            absent_days=rec["absentDays"],
            comp_days=rec["compDays"],
            extra_hours=rec["extraHours"],
            diff=rec["diff"],
            day_adj=rec["dayAdj"],
            base_pay=rec["basePay"],
            ot_pay=rec["otPay"],
            debit_amount=rec["debitAmount"],
            debit_hours=rec["debitHours"],
            debit_hrs_pay=rec["debitHrsPay"],
            night_shifts=rec["nightShifts"],
            night_base=rec["nightBase"],
            night_appr=rec["nightAppr"],
            night_pay=rec["nightPay"],
            total=rec["total"],
        ))


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"status": "ok", "service": "Saavi Payroll API v3"}


# ── Employees ─────────────────────────────────────────────────────────────────
@app.get("/employees")
def list_employees(db: Session = Depends(get_db)):
    return [_emp_dict(e) for e in db.query(EmployeeRow).all()]


def _assert_category_exists(category: str, db: Session):
    if not db.query(CategoryRow).filter(CategoryRow.name == category).first():
        raise HTTPException(400, detail=f"Category '{category}' does not exist")


@app.post("/employees", status_code=201)
def create_employee(emp: Employee, db: Session = Depends(get_db)):
    if db.query(EmployeeRow).filter(EmployeeRow.id == emp.id).first():
        raise HTTPException(400, detail="Employee ID already exists")
    _assert_category_exists(emp.category, db)
    row = EmployeeRow(id=emp.id, name=emp.name, monthly=emp.monthly,
                      hourly=emp.hourly, working_days=emp.workingDays,
                      category=emp.category)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _emp_dict(row)


@app.put("/employees/{emp_id}")
def update_employee(emp_id: str, emp: Employee, db: Session = Depends(get_db)):
    row = db.query(EmployeeRow).filter(EmployeeRow.id == emp_id).first()
    if not row:
        raise HTTPException(404, detail="Employee not found")
    _assert_category_exists(emp.category, db)
    row.name = emp.name
    row.monthly = emp.monthly
    row.hourly = emp.hourly
    row.working_days = emp.workingDays
    row.category = emp.category
    db.commit()
    db.refresh(row)
    return _emp_dict(row)


@app.delete("/employees/{emp_id}")
def delete_employee(emp_id: str, db: Session = Depends(get_db)):
    row = db.query(EmployeeRow).filter(EmployeeRow.id == emp_id).first()
    if not row:
        raise HTTPException(404, detail="Employee not found")
    db.delete(row)
    db.commit()
    return {"deleted": emp_id}


# ── Categories ───────────────────────────────────────────────────────────────
def _cat_dict(row: CategoryRow) -> dict:
    return {"id": row.id, "name": row.name, "nightBase": row.night_base, "nightAppr": row.night_appr}


@app.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return [_cat_dict(c) for c in db.query(CategoryRow).order_by(CategoryRow.name).all()]


@app.post("/categories", status_code=201)
def create_category(cat: CategoryIn, db: Session = Depends(get_db)):
    if db.query(CategoryRow).filter(CategoryRow.name == cat.name).first():
        raise HTTPException(409, detail="Category name already exists")
    row = CategoryRow(name=cat.name, night_base=cat.nightBase, night_appr=cat.nightAppr)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _cat_dict(row)


@app.put("/categories/{cat_id}")
def update_category(cat_id: int, cat: CategoryIn, db: Session = Depends(get_db)):
    row = db.query(CategoryRow).filter(CategoryRow.id == cat_id).first()
    if not row:
        raise HTTPException(404, detail="Category not found")
    existing = db.query(CategoryRow).filter(CategoryRow.name == cat.name, CategoryRow.id != cat_id).first()
    if existing:
        raise HTTPException(409, detail="Category name already exists")
    row.name = cat.name
    row.night_base = cat.nightBase
    row.night_appr = cat.nightAppr
    db.commit()
    db.refresh(row)
    return _cat_dict(row)


@app.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    row = db.query(CategoryRow).filter(CategoryRow.id == cat_id).first()
    if not row:
        raise HTTPException(404, detail="Category not found")
    in_use = db.query(EmployeeRow).filter(EmployeeRow.category == row.name).first()
    if in_use:
        raise HTTPException(400, detail=f"Category is assigned to employees — reassign them first")
    db.delete(row)
    db.commit()
    return {"deleted": cat_id}


# ── Payrolls ──────────────────────────────────────────────────────────────────
@app.get("/payrolls")
def list_payrolls(db: Session = Depends(get_db)):
    payrolls = db.query(PayrollRow).order_by(PayrollRow.month.desc()).all()
    result = []
    for p in payrolls:
        records = db.query(PayrollRecordRow).filter(
            PayrollRecordRow.payroll_month == p.month
        ).all()
        result.append(_payroll_dict(p, records))
    return result


@app.get("/payrolls/{month}")
def get_payroll(month: str, db: Session = Depends(get_db)):
    p = db.query(PayrollRow).filter(PayrollRow.month == month).first()
    if not p:
        raise HTTPException(404, detail="Payroll not found")
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == month
    ).all()
    return _payroll_dict(p, records)


@app.post("/payrolls/preview")
def preview_payroll(payload: PayrollIn, db: Session = Depends(get_db)):
    return _compute_payroll(payload, db)


@app.post("/payrolls", status_code=201)
def save_payroll(payload: PayrollIn, db: Session = Depends(get_db)):
    if db.query(PayrollRow).filter(PayrollRow.month == payload.month).first():
        raise HTTPException(
            400,
            detail=f"Payroll for {payload.month} already exists. Use PUT to overwrite.",
        )
    result = _compute_payroll(payload, db)
    saved_at = datetime.utcnow().isoformat()
    p = PayrollRow(
        month=payload.month,
        from_date=payload.fromDate,
        to_date=payload.toDate,
        comp_days=result["compDays"],
        employee_count=result["employeeCount"],
        total_pay=result["totalPay"],
        saved_at=saved_at,
    )
    db.add(p)
    _persist_records(result, db)
    db.commit()
    db.refresh(p)
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == payload.month
    ).all()
    return _payroll_dict(p, records)


@app.put("/payrolls/{month}")
def update_payroll(month: str, payload: PayrollIn, db: Session = Depends(get_db)):
    result = _compute_payroll(payload, db)
    saved_at = datetime.utcnow().isoformat()
    p = db.query(PayrollRow).filter(PayrollRow.month == month).first()
    if p:
        p.from_date = payload.fromDate
        p.to_date = payload.toDate
        p.comp_days = result["compDays"]
        p.employee_count = result["employeeCount"]
        p.total_pay = result["totalPay"]
        p.saved_at = saved_at
        db.query(PayrollRecordRow).filter(PayrollRecordRow.payroll_month == month).delete()
    else:
        p = PayrollRow(
            month=month,
            from_date=payload.fromDate,
            to_date=payload.toDate,
            comp_days=result["compDays"],
            employee_count=result["employeeCount"],
            total_pay=result["totalPay"],
            saved_at=saved_at,
        )
        db.add(p)
    _persist_records(result, db)
    db.commit()
    db.refresh(p)
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == month
    ).all()
    return _payroll_dict(p, records)


@app.delete("/payrolls/{month}")
def delete_payroll(month: str, db: Session = Depends(get_db)):
    p = db.query(PayrollRow).filter(PayrollRow.month == month).first()
    if not p:
        raise HTTPException(404, detail="Payroll not found")
    db.query(PayrollRecordRow).filter(PayrollRecordRow.payroll_month == month).delete()
    db.delete(p)
    db.commit()
    return {"deleted": month}
