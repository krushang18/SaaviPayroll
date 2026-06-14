from contextlib import asynccontextmanager
from datetime import datetime, date, timezone
from typing import Optional, List
import math, os, re

from fastapi import FastAPI, HTTPException, Depends, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from sqlalchemy import create_engine, Column, String, Float, Integer, Index, text, func
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ── Database ──────────────────────────────────────────────────────────────────
_DB_URL = os.getenv("DATABASE_URL")
if not _DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")
# Render issues the legacy postgres:// scheme; SQLAlchemy requires postgresql://
if _DB_URL.startswith("postgres://"):
    _DB_URL = _DB_URL.replace("postgres://", "postgresql://", 1)

_SAFE_URL = re.sub(r'://[^@]+@', '://***@', _DB_URL)
print(f"[DB] Connecting to PostgreSQL: {_SAFE_URL[:60]}...")

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
    updated_at   = Column(String,  nullable=True)


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
    advance_settlement = Column(Float, default=0)
    night_shifts     = Column(Float, default=0)
    night_base       = Column(Float, default=0)
    night_appr       = Column(Float, default=0)
    night_pay        = Column(Float, default=0)
    normal_leaves    = Column(Float, nullable=True)
    on_call_leaves   = Column(Float, nullable=True)
    effective_oncall = Column(Float, nullable=True)
    late_count       = Column(Float, default=0)
    late_penalty     = Column(Float, default=0)
    total            = Column(Float)


class AdvanceRow(Base):
    __tablename__ = "advances"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    emp_id     = Column(String, nullable=False, index=True)
    date       = Column(String, nullable=False)   # "YYYY-MM-DD"
    amount     = Column(Float, nullable=False)
    note       = Column(String, nullable=True)
    created_at = Column(String, nullable=True)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS debit_hours REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS debit_hrs_pay REAL DEFAULT 0",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS night_shifts REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS night_base REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS night_appr REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS night_pay REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS normal_leaves REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS on_call_leaves REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS effective_oncall REAL DEFAULT NULL",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at TEXT",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS late_count REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS late_penalty REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS advance_settlement REAL DEFAULT 0",
        ]:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()
    yield


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Saavi Payroll API", version="3.0.0", lifespan=lifespan)

_raw_origins = os.getenv("CORS_ORIGINS", "")
CORS_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
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
def _emp_sort_key(emp_id: str):
    return (int(emp_id) if emp_id.isdigit() else float('inf'), emp_id)


def _emp_dict(row: EmployeeRow) -> dict:
    return {
        "id":          row.id,
        "name":        row.name,
        "monthly":     row.monthly,
        "hourly":      row.hourly,
        "workingDays": row.working_days,
        "category":    row.category,
        "updatedAt":   row.updated_at,
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
        "advanceSettlement": row.advance_settlement or 0,
        "nightShifts":  row.night_shifts or 0,
        "nightBase":       row.night_base or 0,
        "nightAppr":       row.night_appr or 0,
        "nightPay":        row.night_pay or 0,
        "normalLeaves":    row.normal_leaves,
        "onCallLeaves":    row.on_call_leaves,
        "effectiveOncall": row.effective_oncall,
        "lateCount":       row.late_count or 0,
        "latePenalty":     row.late_penalty or 0,
        "total":           row.total,
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


def _advance_dict(row: AdvanceRow) -> dict:
    return {"id": row.id, "empId": row.emp_id, "date": row.date, "amount": row.amount, "note": row.note}


def _advance_balances(db: Session) -> dict:
    """Returns {empId: {totalAdvanced, totalSettled, balance}} for employees with any advance activity."""
    given = dict(db.query(AdvanceRow.emp_id, func.sum(AdvanceRow.amount))
                    .group_by(AdvanceRow.emp_id).all())
    settled = dict(db.query(PayrollRecordRow.emp_id, func.sum(PayrollRecordRow.advance_settlement))
                      .group_by(PayrollRecordRow.emp_id).all())
    out = {}
    for emp_id in set(given) | set(settled):
        g = given.get(emp_id, 0) or 0
        s = settled.get(emp_id, 0) or 0
        out[emp_id] = {"totalAdvanced": g, "totalSettled": s, "balance": g - s}
    return out


def _advance_history(emp_id: str, db: Session) -> dict:
    advances = (db.query(AdvanceRow).filter(AdvanceRow.emp_id == emp_id)
                  .order_by(AdvanceRow.date.desc()).all())
    entries = [
        {"type": "given", "id": a.id, "date": a.date, "amount": a.amount, "note": a.note}
        for a in advances
    ]
    settled_rows = (db.query(PayrollRecordRow, PayrollRow)
                       .join(PayrollRow, PayrollRecordRow.payroll_month == PayrollRow.month)
                       .filter(PayrollRecordRow.emp_id == emp_id, PayrollRecordRow.advance_settlement > 0)
                       .all())
    for rec, p in settled_rows:
        entries.append({
            "type": "settled", "month": rec.payroll_month, "date": p.to_date,
            "amount": rec.advance_settlement,
        })
    entries.sort(key=lambda e: e["date"], reverse=True)
    bal = _advance_balances(db).get(emp_id, {"totalAdvanced": 0, "totalSettled": 0, "balance": 0})
    return {"empId": emp_id, **bal, "entries": entries}


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


class AdvanceIn(BaseModel):
    empId: str     = Field(min_length=1)
    date: str      = Field(min_length=1)   # "YYYY-MM-DD"
    amount: float  = Field(gt=0)
    note: Optional[str] = None

    @field_validator('date')
    @classmethod
    def _valid_date(cls, v):
        date.fromisoformat(v)
        return v

    @field_validator('note', mode='before')
    @classmethod
    def _strip_note(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class PayrollEntry(BaseModel):
    empId: str
    presentDays:  Optional[float] = Field(default=None, ge=0, le=31)
    absentDays:   Optional[float] = Field(default=None, ge=0, le=31)
    normalLeaves: Optional[float] = Field(default=None, ge=0, le=99)
    onCallLeaves: Optional[float] = Field(default=None, ge=0, le=99)
    extraHours:   float = Field(default=0, ge=0, le=999)
    debitHours:   float = Field(default=0, ge=0, le=999)
    debitAmount:  float = Field(default=0, ge=0)
    nightShifts:  float = Field(default=0, ge=0, le=99)
    lateCount:    float = Field(default=0, ge=0, le=99)
    advanceSettlement: float = Field(default=0, ge=0)


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

    @model_validator(mode='after')
    def _check_entries(self):
        try:
            pd = _period_days(self.fromDate, self.toDate)
        except Exception:
            return self
        for entry in self.entries:
            if entry.presentDays is not None and entry.presentDays > pd:
                raise ValueError(
                    f'Employee {entry.empId}: presentDays ({entry.presentDays}) exceeds period length ({pd})'
                )
            if entry.absentDays is not None and entry.absentDays > pd:
                raise ValueError(
                    f'Employee {entry.empId}: absentDays ({entry.absentDays}) exceeds period length ({pd})'
                )
            if entry.presentDays is not None and entry.absentDays is not None and \
               entry.presentDays + entry.absentDays > pd:
                raise ValueError(
                    f'Employee {entry.empId}: presentDays + absentDays exceeds period length ({pd})'
                )
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
                 nightShifts: float = 0, nightBase: float = 0, nightAppr: float = 0,
                 normalLeaves: Optional[float] = None, onCallLeaves: Optional[float] = None,
                 lateCount: float = 0, advanceSettlement: float = 0) -> dict:
    pd = _period_days(fromDate, toDate)
    daily = math.floor(emp["monthly"] / 30)
    wd = emp.get("workingDays", 30)

    # On-call leave penalty: first 2 count normally, each beyond 2 counts as 2
    effective_oncall = None
    effective_absent_for_salary = None
    if onCallLeaves is not None or normalLeaves is not None:
        ocl = math.floor(onCallLeaves or 0)
        nl  = math.floor(normalLeaves or 0)
        if absentDays is not None and nl + ocl != math.floor(absentDays):
            raise ValueError(
                f"{emp['name']}: normalLeaves + onCallLeaves ({nl + ocl}) must equal absentDays ({math.floor(absentDays)})"
            )
        if nl + ocl > pd:
            raise ValueError(
                f"{emp['name']}: leaves ({nl + ocl}) exceed period length ({pd})"
            )
        effective_oncall = min(ocl, 2) + max(0, ocl - 2) * 2
        raw_absent = nl + ocl                               # real days off — for display
        effective_absent_for_salary = nl + effective_oncall  # penalized — for salary
        absentDays = raw_absent
        presentDays = None  # re-derived as pd - raw_absent

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
    if effective_absent_for_salary is not None:
        effective_present = pd - effective_absent_for_salary + comp_days
    else:
        effective_present = present + comp_days

    diff = effective_present - wd
    dayAdj = diff * daily
    basePay = emp["monthly"] + dayAdj
    otPay = extraHours * emp["hourly"]
    debitHrsPay = debitHours * emp["hourly"]
    nightPay = nightShifts * (nightBase + nightAppr)

    # Late policy: first 5 "late by 15 min" occurrences are free; each beyond that
    # is penalised based on monthly salary
    late_occurrences = math.floor(lateCount)
    late_penalty_units = max(0, late_occurrences - 5)
    latePenalty = late_penalty_units * (50 if emp["monthly"] <= 10000 else 100)

    total = basePay + otPay + nightPay - debitAmount - debitHrsPay - latePenalty - advanceSettlement

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
        "nightShifts":    nightShifts,
        "nightBase":      nightBase,
        "nightAppr":      nightAppr,
        "nightPay":       nightPay,
        "normalLeaves":   normalLeaves,
        "onCallLeaves":   onCallLeaves,
        "effectiveOncall": effective_oncall,
        "lateCount":      lateCount,
        "latePenalty":    latePenalty,
        "diff":           diff,
        "dayAdj":         dayAdj,
        "basePay":        basePay,
        "otPay":          otPay,
        "debitAmount":    debitAmount,
        "advanceSettlement": advanceSettlement,
        "total":          total,
    }


def _compute_payroll(payload: PayrollIn, db: Session) -> dict:
    records = []
    errors = []

    given = dict(db.query(AdvanceRow.emp_id, func.sum(AdvanceRow.amount))
                    .group_by(AdvanceRow.emp_id).all())
    settled_other_months = dict(
        db.query(PayrollRecordRow.emp_id, func.sum(PayrollRecordRow.advance_settlement))
          .filter(PayrollRecordRow.payroll_month != payload.month)
          .group_by(PayrollRecordRow.emp_id).all()
    )

    for entry in payload.entries:
        row = db.query(EmployeeRow).filter(EmployeeRow.id == entry.empId).first()
        if not row:
            errors.append(f"Employee {entry.empId} not found")
            continue
        emp = _emp_dict(row)
        night_base, night_appr = _emp_night_rates(row, db)

        available = (given.get(entry.empId, 0) or 0) - (settled_other_months.get(entry.empId, 0) or 0)
        if entry.advanceSettlement > available:
            errors.append(
                f"{emp['name']}: advance settlement ({entry.advanceSettlement}) exceeds outstanding balance ({available})"
            )
            continue

        try:
            rec = _calc_record(emp, payload.fromDate, payload.toDate,
                               entry.presentDays, entry.absentDays,
                               entry.extraHours, entry.debitHours, entry.debitAmount,
                               entry.nightShifts, night_base, night_appr,
                               entry.normalLeaves, entry.onCallLeaves,
                               entry.lateCount, entry.advanceSettlement)
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
            advance_settlement=rec.get("advanceSettlement", 0),
            night_shifts=rec["nightShifts"],
            night_base=rec["nightBase"],
            night_appr=rec["nightAppr"],
            night_pay=rec["nightPay"],
            normal_leaves=rec.get("normalLeaves"),
            on_call_leaves=rec.get("onCallLeaves"),
            effective_oncall=rec.get("effectiveOncall"),
            late_count=rec.get("lateCount", 0),
            late_penalty=rec.get("latePenalty", 0),
            total=rec["total"],
        ))


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"status": "ok", "service": "Saavi Payroll API v3"}


# ── Employees ─────────────────────────────────────────────────────────────────
@app.get("/employees")
def list_employees(db: Session = Depends(get_db)):
    rows = db.query(EmployeeRow).all()
    rows.sort(key=lambda e: _emp_sort_key(e.id))
    return [_emp_dict(e) for e in rows]


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
                      category=emp.category,
                      updated_at=datetime.now(timezone.utc).isoformat())
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
    row.updated_at = datetime.now(timezone.utc).isoformat()
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


# ── Advances ─────────────────────────────────────────────────────────────────
@app.get("/advances/balances")
def get_advance_balances(db: Session = Depends(get_db)):
    balances = _advance_balances(db)
    return [{"empId": emp_id, **v} for emp_id, v in balances.items()]


@app.get("/advances/{emp_id}")
def get_advance_history(emp_id: str, db: Session = Depends(get_db)):
    if not db.query(EmployeeRow).filter(EmployeeRow.id == emp_id).first():
        raise HTTPException(404, detail="Employee not found")
    return _advance_history(emp_id, db)


@app.post("/advances", status_code=201)
def create_advance(adv: AdvanceIn, db: Session = Depends(get_db)):
    if not db.query(EmployeeRow).filter(EmployeeRow.id == adv.empId).first():
        raise HTTPException(404, detail="Employee not found")
    row = AdvanceRow(emp_id=adv.empId, date=adv.date, amount=adv.amount, note=adv.note,
                      created_at=datetime.now(timezone.utc).isoformat())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _advance_dict(row)


@app.put("/advances/{advance_id}")
def update_advance(advance_id: int, adv: AdvanceIn, db: Session = Depends(get_db)):
    row = db.query(AdvanceRow).filter(AdvanceRow.id == advance_id).first()
    if not row:
        raise HTTPException(404, detail="Advance entry not found")
    row.date = adv.date
    row.amount = adv.amount
    row.note = adv.note
    db.commit()
    db.refresh(row)
    return _advance_dict(row)


@app.delete("/advances/{advance_id}")
def delete_advance(advance_id: int, db: Session = Depends(get_db)):
    row = db.query(AdvanceRow).filter(AdvanceRow.id == advance_id).first()
    if not row:
        raise HTTPException(404, detail="Advance entry not found")
    balance = _advance_balances(db).get(row.emp_id, {"balance": 0})["balance"]
    if row.amount > balance:
        raise HTTPException(
            400,
            detail=f"Cannot delete — would make outstanding balance negative (current balance {balance})",
        )
    db.delete(row)
    db.commit()
    return {"deleted": advance_id}


# ── Payrolls ──────────────────────────────────────────────────────────────────
@app.get("/payrolls")
def list_payrolls(db: Session = Depends(get_db)):
    payrolls = db.query(PayrollRow).order_by(PayrollRow.month.desc()).all()
    result = []
    for p in payrolls:
        records = db.query(PayrollRecordRow).filter(
            PayrollRecordRow.payroll_month == p.month
        ).all()
        records.sort(key=lambda r: _emp_sort_key(r.emp_id))
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
    records.sort(key=lambda r: _emp_sort_key(r.emp_id))
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
    saved_at = datetime.now(timezone.utc).isoformat()
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
    records.sort(key=lambda r: _emp_sort_key(r.emp_id))
    return _payroll_dict(p, records)


@app.put("/payrolls/{month}")
def update_payroll(month: str, payload: PayrollIn, db: Session = Depends(get_db)):
    if payload.month != month:
        raise HTTPException(400, detail="month in URL must match payload")
    result = _compute_payroll(payload, db)
    saved_at = datetime.now(timezone.utc).isoformat()
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
        raise HTTPException(404, detail="Payroll not found — use POST to create")
    _persist_records(result, db)
    db.commit()
    db.refresh(p)
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == month
    ).all()
    records.sort(key=lambda r: _emp_sort_key(r.emp_id))
    return _payroll_dict(p, records)


@app.delete("/payrolls/{month}")
def delete_payroll(month: str = Path(pattern=r"^\d{4}-\d{2}$"), db: Session = Depends(get_db)):
    p = db.query(PayrollRow).filter(PayrollRow.month == month).first()
    if not p:
        raise HTTPException(404, detail="Payroll not found")
    db.query(PayrollRecordRow).filter(PayrollRecordRow.payroll_month == month).delete()
    db.delete(p)
    db.commit()
    return {"deleted": month}
