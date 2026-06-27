from contextlib import asynccontextmanager
from datetime import datetime, date, timezone
from typing import Optional, List
import math, os, re

from fastapi import FastAPI, HTTPException, Depends, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from sqlalchemy import create_engine, Column, String, Float, Integer, Index, text, func, and_
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

engine = create_engine(
    _DB_URL,
    pool_pre_ping=True,
    pool_recycle=300,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── ORM Models ────────────────────────────────────────────────────────────────
class CategoryRow(Base):
    __tablename__ = "categories"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(String,  nullable=False, unique=True)
    night_base = Column(Float,   default=0)
    night_appr = Column(Float,   default=0)


# Salary and cash employees live in physically separate tables so they have
# independent id namespaces (salary "11" and cash "11" no longer collide). The
# columns are shared via a mixin so the two tables cannot drift apart.
class _EmployeeCols:
    id             = Column(String,  primary_key=True)
    name           = Column(String,  nullable=False)
    monthly        = Column(Float,   nullable=False)
    hourly         = Column(Float,   nullable=False)
    working_days   = Column(Integer, default=30)
    category       = Column(String,  nullable=True)
    updated_at     = Column(String,  nullable=True)
    emp_id         = Column(String,  nullable=True)
    shift_type     = Column(String,  default="Day")
    shift2_monthly = Column(Float,   nullable=True)
    shift2_hourly  = Column(Float,   nullable=True)
    shift2_working_days = Column(Integer, nullable=True)
    pay_type       = Column(String,  default="salary", nullable=False)


class EmployeeRow(_EmployeeCols, Base):
    __tablename__ = "employees"


class CashEmployeeRow(_EmployeeCols, Base):
    __tablename__ = "cash_employees"


class PayrollRow(Base):
    __tablename__ = "payrolls"
    month          = Column(String, primary_key=True)
    pay_type       = Column(String, primary_key=True, default="salary")
    from_date      = Column(String, nullable=False)
    to_date        = Column(String, nullable=False)
    comp_days      = Column(Integer, default=0)
    employee_count = Column(Integer, default=0)
    total_pay      = Column(Float,   default=0.0)
    saved_at       = Column(String)


class PayrollRecordRow(Base):
    __tablename__  = "payroll_records"
    __table_args__ = (Index("ix_pr_month_pt", "payroll_month", "pay_type"),)
    id            = Column(Integer, primary_key=True, autoincrement=True)
    payroll_month = Column(String, nullable=False)
    pay_type      = Column(String, default="salary", nullable=False)
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
    shift2_present_days = Column(Float, nullable=True)
    shift2_absent_days  = Column(Float, nullable=True)
    shift2_extra_hours  = Column(Float, nullable=True)
    shift2_base_pay     = Column(Float, nullable=True)
    shift2_ot_pay       = Column(Float, nullable=True)
    shift2_monthly      = Column(Float, nullable=True)
    shift2_hourly       = Column(Float, nullable=True)
    shift2_working_days = Column(Integer, nullable=True)
    home_visits         = Column(Float, default=0)
    home_visit_rate     = Column(Float, default=0)
    home_visit_pay      = Column(Float, default=0)
    shift2_normal_leaves    = Column(Float, nullable=True)
    shift2_on_call_leaves   = Column(Float, nullable=True)
    shift2_effective_oncall = Column(Float, nullable=True)
    shift2_day_adj          = Column(Float, nullable=True)
    shift2_night_shifts     = Column(Float, nullable=True)
    shift2_night_pay        = Column(Float, nullable=True)
    shift2_home_visits      = Column(Float, nullable=True)
    shift2_home_visit_pay   = Column(Float, nullable=True)
    shift2_debit_hours      = Column(Float, nullable=True)
    shift2_debit_amount     = Column(Float, nullable=True)
    shift2_debit_hrs_pay    = Column(Float, nullable=True)
    shift2_late_count       = Column(Float, nullable=True)
    shift2_late_penalty     = Column(Float, nullable=True)
    shift2_total            = Column(Float, nullable=True)


# Advances and settlements are also split per pay-type so a cash employee's
# advance history can never bleed into a salary employee with the same id.
class _AdvanceCols:
    id         = Column(Integer, primary_key=True, autoincrement=True)
    emp_id     = Column(String, nullable=False, index=True)
    date       = Column(String, nullable=False)   # "YYYY-MM-DD"
    amount     = Column(Float, nullable=False)
    note       = Column(String, nullable=True)
    created_at = Column(String, nullable=True)


class AdvanceRow(_AdvanceCols, Base):
    __tablename__ = "advances"


class CashAdvanceRow(_AdvanceCols, Base):
    __tablename__ = "cash_advances"


class AdvanceSettlementRow(_AdvanceCols, Base):
    __tablename__ = "advance_settlements"


class CashAdvanceSettlementRow(_AdvanceCols, Base):
    __tablename__ = "cash_advance_settlements"


class AppSettingsRow(Base):
    __tablename__ = "app_settings"
    id              = Column(Integer, primary_key=True, default=1)
    home_visit_rate = Column(Float, default=0)


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
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS emp_id TEXT DEFAULT NULL",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'Day'",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift2_monthly REAL DEFAULT NULL",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift2_hourly REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_present_days REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_absent_days REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_extra_hours REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_base_pay REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_ot_pay REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_monthly REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_hourly REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS home_visits REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS home_visit_rate REAL DEFAULT 0",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS home_visit_pay REAL DEFAULT 0",
            "INSERT INTO app_settings (id, home_visit_rate) VALUES (1, 0) ON CONFLICT (id) DO NOTHING",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_type TEXT DEFAULT 'salary'",
            "ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS pay_type TEXT DEFAULT 'salary'",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS pay_type TEXT DEFAULT 'salary'",
            "ALTER TABLE payrolls DROP CONSTRAINT IF EXISTS payrolls_pkey",
            "ALTER TABLE payrolls ADD CONSTRAINT payrolls_pkey PRIMARY KEY (month, pay_type)",
            "DROP INDEX IF EXISTS ix_pr_month",
            "CREATE INDEX IF NOT EXISTS ix_pr_month_pt ON payroll_records (payroll_month, pay_type)",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_normal_leaves REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_on_call_leaves REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_effective_oncall REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_day_adj REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_night_shifts REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_night_pay REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_home_visits REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_home_visit_pay REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_debit_hours REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_debit_amount REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_debit_hrs_pay REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_late_count REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_late_penalty REAL DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_total REAL DEFAULT NULL",
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift2_working_days INTEGER DEFAULT NULL",
            "ALTER TABLE cash_employees ADD COLUMN IF NOT EXISTS shift2_working_days INTEGER DEFAULT NULL",
            "ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS shift2_working_days INTEGER DEFAULT NULL",
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


# ── Pay-type model resolvers ──────────────────────────────────────────────────
# Salary and cash records live in separate tables; the route logic is otherwise
# identical, so it just resolves the right model from the pay-type string.
def _emp_model(pay_type: str):
    return CashEmployeeRow if pay_type == "cash" else EmployeeRow

def _adv_model(pay_type: str):
    return CashAdvanceRow if pay_type == "cash" else AdvanceRow

def _settle_model(pay_type: str):
    return CashAdvanceSettlementRow if pay_type == "cash" else AdvanceSettlementRow


# ── Serialisation helpers ─────────────────────────────────────────────────────
def _emp_sort_key(emp_id: str):
    return (int(emp_id) if emp_id.isdigit() else float('inf'), emp_id)


def _emp_dict(row: EmployeeRow) -> dict:
    return {
        "id":            row.id,
        "name":          row.name,
        "monthly":       row.monthly,
        "hourly":        row.hourly,
        "workingDays":   row.working_days,
        "category":      row.category,
        "updatedAt":     row.updated_at,
        "empId":         row.emp_id,
        "shiftType":     row.shift_type or "Day",
        "shift2Monthly": row.shift2_monthly,
        "shift2Hourly":  row.shift2_hourly,
        "shift2WorkingDays": row.shift2_working_days,
        "payType":       row.pay_type or "salary",
    }


def _emp_night_rates(row: EmployeeRow, db: Session):
    if row.category:
        cat = db.query(CategoryRow).filter(CategoryRow.name == row.category).first()
        if cat:
            return cat.night_base, cat.night_appr
    return 0.0, 0.0


def _get_home_visit_rate(db: Session) -> float:
    row = db.query(AppSettingsRow).filter(AppSettingsRow.id == 1).first()
    return row.home_visit_rate if row else 0.0


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
        "shift2PresentDays": row.shift2_present_days,
        "shift2AbsentDays":  row.shift2_absent_days,
        "shift2ExtraHours":  row.shift2_extra_hours,
        "shift2BasePay":     row.shift2_base_pay,
        "shift2OtPay":       row.shift2_ot_pay,
        "shift2Monthly":     row.shift2_monthly,
        "shift2Hourly":      row.shift2_hourly,
        "shift2WorkingDays": row.shift2_working_days,
        "homeVisits":        row.home_visits or 0,
        "homeVisitRate":     row.home_visit_rate or 0,
        "homeVisitPay":      row.home_visit_pay or 0,
        "shift2NormalLeaves":    row.shift2_normal_leaves,
        "shift2OnCallLeaves":    row.shift2_on_call_leaves,
        "shift2EffectiveOncall": row.shift2_effective_oncall,
        "shift2DayAdj":          row.shift2_day_adj,
        "shift2NightShifts":     row.shift2_night_shifts,
        "shift2NightPay":        row.shift2_night_pay,
        "shift2HomeVisits":      row.shift2_home_visits,
        "shift2HomeVisitPay":    row.shift2_home_visit_pay,
        "shift2DebitHours":      row.shift2_debit_hours,
        "shift2DebitAmount":     row.shift2_debit_amount,
        "shift2DebitHrsPay":     row.shift2_debit_hrs_pay,
        "shift2LateCount":       row.shift2_late_count,
        "shift2LatePenalty":     row.shift2_late_penalty,
        "shift2Total":           row.shift2_total,
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
        "payType":       p.pay_type or "salary",
    }


def _advance_dict(row: AdvanceRow) -> dict:
    return {"id": row.id, "empId": row.emp_id, "date": row.date, "amount": row.amount, "note": row.note}

def _advance_settlement_dict(row: AdvanceSettlementRow) -> dict:
    return {"id": row.id, "empId": row.emp_id, "date": row.date, "amount": row.amount, "note": row.note}


def _advance_balances(db: Session, pay_type: str = "salary", emp_ids: list = None) -> dict:
    """Returns {empId: {totalAdvanced, totalSettled, balance}} for employees with any advance activity."""
    Adv, Settle = _adv_model(pay_type), _settle_model(pay_type)
    q_given = db.query(Adv.emp_id, func.sum(Adv.amount)).group_by(Adv.emp_id)
    q_payroll = (db.query(PayrollRecordRow.emp_id, func.sum(PayrollRecordRow.advance_settlement))
                   .filter(PayrollRecordRow.pay_type == pay_type).group_by(PayrollRecordRow.emp_id))
    q_manual = db.query(Settle.emp_id, func.sum(Settle.amount)).group_by(Settle.emp_id)
    if emp_ids is not None:
        q_given = q_given.filter(Adv.emp_id.in_(emp_ids))
        q_payroll = q_payroll.filter(PayrollRecordRow.emp_id.in_(emp_ids))
        q_manual = q_manual.filter(Settle.emp_id.in_(emp_ids))
    given = dict(q_given.all())
    settled_payroll = dict(q_payroll.all())
    settled_manual = dict(q_manual.all())
    out = {}
    for emp_id in set(given) | set(settled_payroll) | set(settled_manual):
        g = given.get(emp_id, 0) or 0
        sp = settled_payroll.get(emp_id, 0) or 0
        sm = settled_manual.get(emp_id, 0) or 0
        out[emp_id] = {"totalAdvanced": g, "totalSettled": sp + sm, "balance": g - sp - sm}
    return out


def _advance_history(emp_id: str, db: Session, pay_type: str = "salary") -> dict:
    Adv, Settle = _adv_model(pay_type), _settle_model(pay_type)
    advances = (db.query(Adv).filter(Adv.emp_id == emp_id)
                  .order_by(Adv.date.desc()).all())
    entries = [
        {"type": "given", "id": a.id, "date": a.date, "amount": a.amount, "note": a.note}
        for a in advances
    ]
    settled_rows = (db.query(PayrollRecordRow, PayrollRow)
                       .join(PayrollRow, and_(
                           PayrollRecordRow.payroll_month == PayrollRow.month,
                           PayrollRecordRow.pay_type == PayrollRow.pay_type))
                       .filter(PayrollRecordRow.emp_id == emp_id,
                               PayrollRecordRow.pay_type == pay_type,
                               PayrollRecordRow.advance_settlement > 0)
                       .all())
    for rec, p in settled_rows:
        entries.append({
            "type": "settled", "month": rec.payroll_month, "date": p.to_date,
            "amount": rec.advance_settlement,
        })
    manual_rows = (db.query(Settle)
                     .filter(Settle.emp_id == emp_id).all())
    for ms in manual_rows:
        entries.append({
            "type": "settled_manual", "id": ms.id, "date": ms.date,
            "amount": ms.amount, "note": ms.note,
        })
    entries.sort(key=lambda e: e["date"], reverse=True)
    bal = _advance_balances(db, pay_type).get(emp_id, {"totalAdvanced": 0, "totalSettled": 0, "balance": 0})
    return {"empId": emp_id, **bal, "entries": entries}


# ── Pydantic models ───────────────────────────────────────────────────────────
class Employee(BaseModel):
    id: str          = Field(min_length=1)
    name: str        = Field(min_length=1)
    monthly: float   = Field(ge=0)
    hourly: float    = Field(ge=0)
    workingDays: int = Field(default=30, ge=1, le=31)
    category: str    = Field(min_length=1)
    empId: Optional[str] = Field(default=None)
    shiftType: str   = Field(default="Day")
    payType: str     = Field(default="salary")
    shift2Monthly: Optional[float] = Field(default=None, ge=0)
    shift2Hourly: Optional[float]  = Field(default=None, ge=0)
    shift2WorkingDays: Optional[int] = Field(default=None, ge=1, le=31)

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

    @model_validator(mode='after')
    def _require_shift2_working_days(self):
        # Night shift carries its own working-days baseline; it must be set explicitly
        # for a Day & Night employee (mirrors the required night salary/hourly).
        if self.shiftType == 'Day & Night' and self.shift2WorkingDays is None:
            raise ValueError('shift2WorkingDays is required for a Day & Night employee')
        return self

    @field_validator('empId', mode='before')
    @classmethod
    def _strip_emp_id(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator('shiftType')
    @classmethod
    def _valid_shift_type(cls, v):
        if v not in ("Day", "Night", "Day & Night"):
            raise ValueError("shiftType must be 'Day', 'Night', or 'Day & Night'")
        return v

    @field_validator('payType')
    @classmethod
    def _valid_pay_type(cls, v):
        if v not in ("salary", "cash"):
            raise ValueError("payType must be 'salary' or 'cash'")
        return v

    @model_validator(mode='after')
    def _check_shift2_rates(self):
        if self.shiftType == "Day & Night" and (self.shift2Monthly is None or self.shift2Hourly is None):
            raise ValueError("shift2Monthly and shift2Hourly are required when shiftType is 'Day & Night'")
        return self


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
    payType: str   = Field(default="salary")

    @field_validator('date')
    @classmethod
    def _valid_date(cls, v):
        date.fromisoformat(v)
        return v

    @field_validator('payType')
    @classmethod
    def _valid_pay_type(cls, v):
        if v not in ("salary", "cash"):
            raise ValueError("payType must be 'salary' or 'cash'")
        return v

    @field_validator('note', mode='before')
    @classmethod
    def _strip_note(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class AdvanceSettlementIn(BaseModel):
    empId: str     = Field(min_length=1)
    date: str      = Field(min_length=1)   # "YYYY-MM-DD"
    amount: float  = Field(gt=0)
    note: Optional[str] = None
    payType: str   = Field(default="salary")

    @field_validator('date')
    @classmethod
    def _valid_date(cls, v):
        date.fromisoformat(v)
        return v

    @field_validator('payType')
    @classmethod
    def _valid_pay_type(cls, v):
        if v not in ("salary", "cash"):
            raise ValueError("payType must be 'salary' or 'cash'")
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
    homeVisits: float = Field(default=0, ge=0, le=99)
    shift2PresentDays: Optional[float] = Field(default=None, ge=0, le=31)
    shift2AbsentDays:  Optional[float] = Field(default=None, ge=0, le=31)
    shift2ExtraHours:  float = Field(default=0, ge=0, le=999)
    shift2NormalLeaves: Optional[float] = Field(default=None, ge=0, le=99)
    shift2OnCallLeaves: Optional[float] = Field(default=None, ge=0, le=99)
    shift2NightShifts:  float = Field(default=0, ge=0, le=99)
    shift2HomeVisits:   float = Field(default=0, ge=0, le=99)
    shift2DebitHours:   float = Field(default=0, ge=0, le=999)
    shift2DebitAmount:  float = Field(default=0, ge=0)
    shift2LateCount:    float = Field(default=0, ge=0, le=99)


class PayrollIn(BaseModel):
    month: str                          # "2026-04"
    fromDate: str                       # "2026-03-26"
    toDate: str                         # "2026-04-25"
    payType: str = Field(default="salary")
    entries: List[PayrollEntry] = Field(min_length=1)

    @field_validator('payType')
    @classmethod
    def _valid_pay_type(cls, v):
        if v not in ("salary", "cash"):
            raise ValueError("payType must be 'salary' or 'cash'")
        return v

    @field_validator('month')
    @classmethod
    def _valid_month(cls, v):
        if not re.match(r'^\d{4}-\d{2}$', v):
            raise ValueError("month must be in 'YYYY-MM' format")
        return v

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
            if entry.shift2PresentDays is not None and entry.shift2PresentDays > pd:
                raise ValueError(
                    f'Employee {entry.empId}: shift2PresentDays ({entry.shift2PresentDays}) exceeds period length ({pd})'
                )
            if entry.shift2AbsentDays is not None and entry.shift2AbsentDays > pd:
                raise ValueError(
                    f'Employee {entry.empId}: shift2AbsentDays ({entry.shift2AbsentDays}) exceeds period length ({pd})'
                )
            if entry.shift2PresentDays is not None and entry.shift2AbsentDays is not None and \
               entry.shift2PresentDays + entry.shift2AbsentDays > pd:
                raise ValueError(
                    f'Employee {entry.empId}: shift2PresentDays + shift2AbsentDays exceeds period length ({pd})'
                )
        return self


# ── Payroll logic (exact mirror of frontend computeSalary) ────────────────────
#
# daily   = monthly / 30  (exact; floored only for display)
# diff    = floor(present) - workingDays
# dayAdj  = diff * daily
# basePay = monthly + dayAdj
# otPay   = extraHours * hourly
# total   = floor(basePay + otPay - debitAmount - ...)

def _period_days(from_date: str, to_date: str) -> int:
    d1 = date.fromisoformat(from_date)
    d2 = date.fromisoformat(to_date)
    return (d2 - d1).days + 1


def _calc_shift(monthly: float, hourly: float, wd: int, pd: int, comp_days: int,
                present: Optional[float], absent: Optional[float],
                normalLeaves: Optional[float], onCallLeaves: Optional[float],
                extraHours: float, nightShifts: float, nightBase: float, nightAppr: float,
                homeVisits: float, homeVisitRate: float,
                debitHours: float, debitAmount: float, lateCount: float,
                label: str) -> dict:
    """Computes one shift's full pay independently — leave weighting, attendance,
    additions (OT/night/home), and deductions (debit/late). Each shift owns its
    own 5-free-late-occurrences allowance and its own leave breakdown."""
    daily = monthly / 30

    # On-call leave penalty: first 2 count normally, each beyond 2 counts as 2
    effective_oncall = None
    effective_absent_for_salary = None
    if onCallLeaves is not None or normalLeaves is not None:
        ocl = math.floor(onCallLeaves or 0)
        nl  = math.floor(normalLeaves or 0)
        if absent is not None and nl + ocl != math.floor(absent):
            raise ValueError(
                f"{label}: normalLeaves + onCallLeaves ({nl + ocl}) must equal absentDays ({math.floor(absent)})"
            )
        if nl + ocl > pd:
            raise ValueError(f"{label}: leaves ({nl + ocl}) exceed period length ({pd})")
        effective_oncall = min(ocl, 2) + max(0, ocl - 2) * 2
        raw_absent = nl + ocl                               # real days off — for display
        effective_absent_for_salary = nl + effective_oncall  # penalized — for salary
        absent = raw_absent
        present = None  # re-derived as pd - raw_absent

    if present is None and absent is None:
        raise ValueError(f"{label}: provide presentDays or absentDays")
    if present is None:
        present = pd - absent
    if absent is None:
        absent = pd - present

    present = math.floor(present)
    absent = math.floor(absent)
    if present < 0:
        raise ValueError(f"{label}: presentDays cannot be negative")

    if effective_absent_for_salary is not None:
        effective_present = pd - effective_absent_for_salary + comp_days
    else:
        effective_present = present + comp_days

    diff = effective_present - wd
    dayAdj = diff * daily
    basePay = monthly + dayAdj
    otPay = extraHours * hourly
    debitHrsPay = debitHours * hourly
    nightPay = nightShifts * (nightBase + nightAppr)
    homeVisitPay = homeVisits * homeVisitRate

    # Late policy: first 5 "late by 15 min" occurrences are free; each beyond that
    # is penalised based on monthly salary — independent per shift.
    late_occurrences = math.floor(lateCount)
    late_penalty_units = max(0, late_occurrences - 5)
    latePenalty = late_penalty_units * (50 if monthly < 10000 else 100)

    total = basePay + otPay + nightPay + homeVisitPay - debitAmount - debitHrsPay - latePenalty

    return {
        "daily": math.floor(daily), "present": present, "absent": absent,
        "normalLeaves": normalLeaves, "onCallLeaves": onCallLeaves, "effectiveOncall": effective_oncall,
        "diff": diff, "dayAdj": math.floor(dayAdj), "basePay": math.floor(basePay),
        "extraHours": extraHours, "otPay": math.floor(otPay),
        "nightShifts": nightShifts, "nightBase": nightBase, "nightAppr": nightAppr,
        "nightPay": math.floor(nightPay),
        "homeVisits": homeVisits, "homeVisitRate": homeVisitRate, "homeVisitPay": math.floor(homeVisitPay),
        "debitHours": debitHours, "debitAmount": debitAmount, "debitHrsPay": math.floor(debitHrsPay),
        "lateCount": lateCount, "latePenalty": latePenalty,
        "total": total,
    }


def _calc_record(emp: dict, fromDate: str, toDate: str,
                 presentDays: Optional[float], absentDays: Optional[float],
                 extraHours: float, debitHours: float = 0, debitAmount: float = 0,
                 nightShifts: float = 0, nightBase: float = 0, nightAppr: float = 0,
                 normalLeaves: Optional[float] = None, onCallLeaves: Optional[float] = None,
                 lateCount: float = 0, advanceSettlement: float = 0,
                 homeVisits: float = 0, homeVisitRate: float = 0,
                 shift2PresentDays: Optional[float] = None, shift2AbsentDays: Optional[float] = None,
                 shift2ExtraHours: float = 0,
                 shift2NormalLeaves: Optional[float] = None, shift2OnCallLeaves: Optional[float] = None,
                 shift2NightShifts: float = 0, shift2HomeVisits: float = 0,
                 shift2DebitHours: float = 0, shift2DebitAmount: float = 0,
                 shift2LateCount: float = 0) -> dict:
    pd = _period_days(fromDate, toDate)
    wd = emp.get("workingDays", 30)
    # Night shift carries its own working-days baseline; fall back to the day value when unset.
    wd2 = emp.get("shift2WorkingDays") or wd
    # Months shorter than 30 days get free complementary days (salary is always /30)
    comp_days = max(0, 30 - pd)

    day = _calc_shift(emp["monthly"], emp["hourly"], wd, pd, comp_days,
                       presentDays, absentDays, normalLeaves, onCallLeaves,
                       extraHours, nightShifts, nightBase, nightAppr,
                       homeVisits, homeVisitRate, debitHours, debitAmount, lateCount,
                       emp["name"])

    # Day & Night employees: the night shift is a completely independent row —
    # its own leave breakdown, additions, and deductions, computed and totalled separately.
    shift2 = None
    is_dual = emp.get("shiftType") == "Day & Night" and emp.get("shift2Monthly") is not None
    if is_dual:
        if shift2PresentDays is None and shift2AbsentDays is None and \
           shift2NormalLeaves is None and shift2OnCallLeaves is None:
            raise ValueError(f"{emp['name']}: provide shift2PresentDays or shift2AbsentDays for the night shift")
        shift2 = _calc_shift(emp["shift2Monthly"], emp["shift2Hourly"], wd2, pd, comp_days,
                              shift2PresentDays, shift2AbsentDays, shift2NormalLeaves, shift2OnCallLeaves,
                              shift2ExtraHours, shift2NightShifts, nightBase, nightAppr,
                              shift2HomeVisits, homeVisitRate, shift2DebitHours, shift2DebitAmount, shift2LateCount,
                              f"{emp['name']} (night shift)")

    total = math.floor(day["total"] + (shift2["total"] if shift2 else 0) - advanceSettlement)

    return {
        "empId":       emp["id"],
        "empName":     emp["name"],
        "monthly":     emp["monthly"],
        "daily":       day["daily"],
        "hourly":      emp["hourly"],
        "workingDays": wd,
        "periodDays":  pd,
        "presentDays": day["present"],
        "absentDays":  day["absent"],
        "compDays":    comp_days,
        "extraHours":  day["extraHours"],
        "debitHours":  day["debitHours"],
        "debitHrsPay": day["debitHrsPay"],
        "nightShifts":    day["nightShifts"],
        "nightBase":      day["nightBase"],
        "nightAppr":      day["nightAppr"],
        "nightPay":       day["nightPay"],
        "normalLeaves":   day["normalLeaves"],
        "onCallLeaves":   day["onCallLeaves"],
        "effectiveOncall": day["effectiveOncall"],
        "lateCount":      day["lateCount"],
        "latePenalty":    day["latePenalty"],
        "diff":           day["diff"],
        "dayAdj":         day["dayAdj"],
        "basePay":        day["basePay"],
        "otPay":          day["otPay"],
        "debitAmount":    day["debitAmount"],
        "advanceSettlement": advanceSettlement,
        "homeVisits":     day["homeVisits"],
        "homeVisitRate":  day["homeVisitRate"],
        "homeVisitPay":   day["homeVisitPay"],
        "total":          total,
        "shift2PresentDays":      shift2["present"] if shift2 else None,
        "shift2AbsentDays":       shift2["absent"] if shift2 else None,
        "shift2ExtraHours":       shift2["extraHours"] if shift2 else None,
        "shift2BasePay":          shift2["basePay"] if shift2 else None,
        "shift2OtPay":            shift2["otPay"] if shift2 else None,
        "shift2Monthly":          emp.get("shift2Monthly") if shift2 else None,
        "shift2Hourly":           emp.get("shift2Hourly") if shift2 else None,
        "shift2WorkingDays":      wd2 if shift2 else None,
        "shift2NormalLeaves":     shift2["normalLeaves"] if shift2 else None,
        "shift2OnCallLeaves":     shift2["onCallLeaves"] if shift2 else None,
        "shift2EffectiveOncall":  shift2["effectiveOncall"] if shift2 else None,
        "shift2DayAdj":           shift2["dayAdj"] if shift2 else None,
        "shift2NightShifts":      shift2["nightShifts"] if shift2 else None,
        "shift2NightPay":         shift2["nightPay"] if shift2 else None,
        "shift2HomeVisits":       shift2["homeVisits"] if shift2 else None,
        "shift2HomeVisitPay":     shift2["homeVisitPay"] if shift2 else None,
        "shift2DebitHours":       shift2["debitHours"] if shift2 else None,
        "shift2DebitAmount":      shift2["debitAmount"] if shift2 else None,
        "shift2DebitHrsPay":      shift2["debitHrsPay"] if shift2 else None,
        "shift2LateCount":        shift2["lateCount"] if shift2 else None,
        "shift2LatePenalty":      shift2["latePenalty"] if shift2 else None,
        "shift2Total":            shift2["total"] if shift2 else None,
    }


def _compute_payroll(payload: PayrollIn, db: Session) -> dict:
    records = []
    errors = []

    Emp, Adv, Settle = _emp_model(payload.payType), _adv_model(payload.payType), _settle_model(payload.payType)
    given = dict(db.query(Adv.emp_id, func.sum(Adv.amount))
                    .group_by(Adv.emp_id).all())
    settled_other_months = dict(
        db.query(PayrollRecordRow.emp_id, func.sum(PayrollRecordRow.advance_settlement))
          .filter(PayrollRecordRow.payroll_month != payload.month,
                  PayrollRecordRow.pay_type == payload.payType)
          .group_by(PayrollRecordRow.emp_id).all()
    )
    manual_settled = dict(
        db.query(Settle.emp_id, func.sum(Settle.amount))
          .group_by(Settle.emp_id).all()
    )

    home_visit_rate = _get_home_visit_rate(db)

    for entry in payload.entries:
        row = db.query(Emp).filter(Emp.id == entry.empId).first()
        if not row:
            errors.append(f"Employee {entry.empId} not found")
            continue
        emp = _emp_dict(row)
        night_base, night_appr = _emp_night_rates(row, db)

        available = (given.get(entry.empId, 0) or 0) - (settled_other_months.get(entry.empId, 0) or 0) - (manual_settled.get(entry.empId, 0) or 0)
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
                               entry.lateCount, entry.advanceSettlement,
                               entry.homeVisits, home_visit_rate,
                               entry.shift2PresentDays, entry.shift2AbsentDays,
                               entry.shift2ExtraHours,
                               entry.shift2NormalLeaves, entry.shift2OnCallLeaves,
                               entry.shift2NightShifts, entry.shift2HomeVisits,
                               entry.shift2DebitHours, entry.shift2DebitAmount,
                               entry.shift2LateCount)
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


def _persist_records(result: dict, db: Session, pay_type: str = "salary"):
    for rec in result["records"]:
        db.add(PayrollRecordRow(
            payroll_month=result["month"],
            pay_type=pay_type,
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
            shift2_present_days=rec.get("shift2PresentDays"),
            shift2_absent_days=rec.get("shift2AbsentDays"),
            shift2_extra_hours=rec.get("shift2ExtraHours"),
            shift2_base_pay=rec.get("shift2BasePay"),
            shift2_ot_pay=rec.get("shift2OtPay"),
            shift2_monthly=rec.get("shift2Monthly"),
            shift2_hourly=rec.get("shift2Hourly"),
            shift2_working_days=rec.get("shift2WorkingDays"),
            home_visits=rec.get("homeVisits", 0),
            home_visit_rate=rec.get("homeVisitRate", 0),
            home_visit_pay=rec.get("homeVisitPay", 0),
            shift2_normal_leaves=rec.get("shift2NormalLeaves"),
            shift2_on_call_leaves=rec.get("shift2OnCallLeaves"),
            shift2_effective_oncall=rec.get("shift2EffectiveOncall"),
            shift2_day_adj=rec.get("shift2DayAdj"),
            shift2_night_shifts=rec.get("shift2NightShifts"),
            shift2_night_pay=rec.get("shift2NightPay"),
            shift2_home_visits=rec.get("shift2HomeVisits"),
            shift2_home_visit_pay=rec.get("shift2HomeVisitPay"),
            shift2_debit_hours=rec.get("shift2DebitHours"),
            shift2_debit_amount=rec.get("shift2DebitAmount"),
            shift2_debit_hrs_pay=rec.get("shift2DebitHrsPay"),
            shift2_late_count=rec.get("shift2LateCount"),
            shift2_late_penalty=rec.get("shift2LatePenalty"),
            shift2_total=rec.get("shift2Total"),
        ))


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"status": "ok", "service": "Saavi Payroll API v3"}


# ── Employees ─────────────────────────────────────────────────────────────────
@app.get("/employees")
def list_employees(pay_type: str = "salary", db: Session = Depends(get_db)):
    Emp = _emp_model(pay_type)
    rows = db.query(Emp).all()
    rows.sort(key=lambda e: _emp_sort_key(e.id))
    return [_emp_dict(e) for e in rows]


def _assert_category_exists(category: str, db: Session):
    if not db.query(CategoryRow).filter(CategoryRow.name == category).first():
        raise HTTPException(400, detail=f"Category '{category}' does not exist")


@app.post("/employees", status_code=201)
def create_employee(emp: Employee, db: Session = Depends(get_db)):
    Emp = _emp_model(emp.payType)
    if db.query(Emp).filter(Emp.id == emp.id).first():
        raise HTTPException(400, detail="Employee ID already exists")
    _assert_category_exists(emp.category, db)
    row = Emp(id=emp.id, name=emp.name, monthly=emp.monthly,
              hourly=emp.hourly, working_days=emp.workingDays,
              category=emp.category, emp_id=emp.empId,
              shift_type=emp.shiftType, shift2_monthly=emp.shift2Monthly,
              shift2_hourly=emp.shift2Hourly, shift2_working_days=emp.shift2WorkingDays,
              pay_type=emp.payType,
              updated_at=datetime.now(timezone.utc).isoformat())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _emp_dict(row)


@app.put("/employees/{emp_id}")
def update_employee(emp_id: str, emp: Employee, db: Session = Depends(get_db)):
    Emp = _emp_model(emp.payType)
    row = db.query(Emp).filter(Emp.id == emp_id).first()
    if not row:
        raise HTTPException(404, detail="Employee not found")
    _assert_category_exists(emp.category, db)
    row.name = emp.name
    row.monthly = emp.monthly
    row.hourly = emp.hourly
    row.working_days = emp.workingDays
    row.category = emp.category
    row.emp_id = emp.empId
    row.shift_type = emp.shiftType
    row.shift2_monthly = emp.shift2Monthly
    row.shift2_hourly = emp.shift2Hourly
    row.shift2_working_days = emp.shift2WorkingDays
    row.updated_at = datetime.now(timezone.utc).isoformat()
    db.commit()
    db.refresh(row)
    return _emp_dict(row)


@app.delete("/employees/{emp_id}")
def delete_employee(emp_id: str, pay_type: str = "salary", db: Session = Depends(get_db)):
    Emp = _emp_model(pay_type)
    row = db.query(Emp).filter(Emp.id == emp_id).first()
    if not row:
        raise HTTPException(404, detail="Employee not found")
    db.delete(row)
    db.commit()
    return {"deleted": emp_id}


# ── Settings ─────────────────────────────────────────────────────────────────
class SettingsIn(BaseModel):
    homeVisitRate: float = Field(default=0, ge=0)


@app.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    row = db.query(AppSettingsRow).filter(AppSettingsRow.id == 1).first()
    return {"homeVisitRate": row.home_visit_rate if row else 0}


@app.put("/settings")
def update_settings(s: SettingsIn, db: Session = Depends(get_db)):
    row = db.query(AppSettingsRow).filter(AppSettingsRow.id == 1).first()
    if not row:
        row = AppSettingsRow(id=1, home_visit_rate=s.homeVisitRate)
        db.add(row)
    else:
        row.home_visit_rate = s.homeVisitRate
    db.commit()
    return {"homeVisitRate": row.home_visit_rate}


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
    in_use = (db.query(EmployeeRow).filter(EmployeeRow.category == row.name).first()
              or db.query(CashEmployeeRow).filter(CashEmployeeRow.category == row.name).first())
    if in_use:
        raise HTTPException(400, detail=f"Category is assigned to employees — reassign them first")
    db.delete(row)
    db.commit()
    return {"deleted": cat_id}


# ── Advances ─────────────────────────────────────────────────────────────────
@app.get("/advances/balances")
def get_advance_balances(pay_type: str = "salary", db: Session = Depends(get_db)):
    group_ids = [eid for (eid,) in db.query(_emp_model(pay_type).id).all()]
    balances = _advance_balances(db, pay_type, emp_ids=group_ids)
    return [{"empId": emp_id, **v} for emp_id, v in balances.items()]


@app.get("/advances/{emp_id}")
def get_advance_history(emp_id: str, pay_type: str = "salary", db: Session = Depends(get_db)):
    if not db.query(_emp_model(pay_type)).filter(_emp_model(pay_type).id == emp_id).first():
        raise HTTPException(404, detail="Employee not found")
    return _advance_history(emp_id, db, pay_type)


@app.post("/advances", status_code=201)
def create_advance(adv: AdvanceIn, db: Session = Depends(get_db)):
    Emp, Adv = _emp_model(adv.payType), _adv_model(adv.payType)
    if not db.query(Emp).filter(Emp.id == adv.empId).first():
        raise HTTPException(404, detail="Employee not found")
    row = Adv(emp_id=adv.empId, date=adv.date, amount=adv.amount, note=adv.note,
              created_at=datetime.now(timezone.utc).isoformat())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _advance_dict(row)


@app.put("/advances/{advance_id}")
def update_advance(advance_id: int, adv: AdvanceIn, db: Session = Depends(get_db)):
    Adv = _adv_model(adv.payType)
    row = db.query(Adv).filter(Adv.id == advance_id).first()
    if not row:
        raise HTTPException(404, detail="Advance entry not found")
    row.date = adv.date
    row.amount = adv.amount
    row.note = adv.note
    db.commit()
    db.refresh(row)
    return _advance_dict(row)


@app.delete("/advances/{advance_id}")
def delete_advance(advance_id: int, pay_type: str = "salary", db: Session = Depends(get_db)):
    Adv = _adv_model(pay_type)
    row = db.query(Adv).filter(Adv.id == advance_id).first()
    if not row:
        raise HTTPException(404, detail="Advance entry not found")
    balance = _advance_balances(db, pay_type).get(row.emp_id, {"balance": 0})["balance"]
    if row.amount > balance:
        raise HTTPException(
            400,
            detail=f"Cannot delete — would make outstanding balance negative (current balance {balance})",
        )
    db.delete(row)
    db.commit()
    return {"deleted": advance_id}


# ── Advance Settlements (manual / cash) ─────────────────────────────────────
@app.post("/advance-settlements", status_code=201)
def create_advance_settlement(s: AdvanceSettlementIn, db: Session = Depends(get_db)):
    Emp, Adv, Settle = _emp_model(s.payType), _adv_model(s.payType), _settle_model(s.payType)
    if not db.query(Emp).filter(Emp.id == s.empId).first():
        raise HTTPException(404, detail="Employee not found")
    first_advance = db.query(func.min(Adv.date)).filter(Adv.emp_id == s.empId).scalar()
    if not first_advance:
        raise HTTPException(400, detail="No advances found for this employee")
    if s.date < first_advance:
        raise HTTPException(400, detail=f"Settlement date cannot be before first advance date ({first_advance})")
    balance = _advance_balances(db, s.payType).get(s.empId, {"balance": 0})["balance"]
    if s.amount > balance:
        raise HTTPException(400, detail=f"Settlement amount ({s.amount}) exceeds outstanding balance ({balance})")
    row = Settle(emp_id=s.empId, date=s.date, amount=s.amount, note=s.note,
                 created_at=datetime.now(timezone.utc).isoformat())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _advance_settlement_dict(row)


@app.put("/advance-settlements/{settlement_id}")
def update_advance_settlement(settlement_id: int, s: AdvanceSettlementIn, db: Session = Depends(get_db)):
    Adv, Settle = _adv_model(s.payType), _settle_model(s.payType)
    row = db.query(Settle).filter(Settle.id == settlement_id).first()
    if not row:
        raise HTTPException(404, detail="Settlement entry not found")
    first_advance = db.query(func.min(Adv.date)).filter(Adv.emp_id == row.emp_id).scalar()
    if first_advance and s.date < first_advance:
        raise HTTPException(400, detail=f"Settlement date cannot be before first advance date ({first_advance})")
    balance = _advance_balances(db, s.payType).get(row.emp_id, {"balance": 0})["balance"]
    max_allowed = balance + row.amount
    if s.amount > max_allowed:
        raise HTTPException(400, detail=f"Settlement amount ({s.amount}) exceeds outstanding balance ({max_allowed})")
    row.date = s.date
    row.amount = s.amount
    row.note = s.note
    db.commit()
    db.refresh(row)
    return _advance_settlement_dict(row)


@app.delete("/advance-settlements/{settlement_id}")
def delete_advance_settlement(settlement_id: int, pay_type: str = "salary", db: Session = Depends(get_db)):
    Settle = _settle_model(pay_type)
    row = db.query(Settle).filter(Settle.id == settlement_id).first()
    if not row:
        raise HTTPException(404, detail="Settlement entry not found")
    db.delete(row)
    db.commit()
    return {"deleted": settlement_id}


# ── Payrolls ──────────────────────────────────────────────────────────────────
@app.get("/payrolls")
def list_payrolls(pay_type: str = "salary", db: Session = Depends(get_db)):
    payrolls = db.query(PayrollRow).filter(PayrollRow.pay_type == pay_type).order_by(PayrollRow.month.desc()).all()
    result = []
    for p in payrolls:
        records = db.query(PayrollRecordRow).filter(
            PayrollRecordRow.payroll_month == p.month,
            PayrollRecordRow.pay_type == pay_type,
        ).all()
        records.sort(key=lambda r: _emp_sort_key(r.emp_id))
        result.append(_payroll_dict(p, records))
    return result


@app.get("/payrolls/{month}")
def get_payroll(month: str, pay_type: str = "salary", db: Session = Depends(get_db)):
    p = db.query(PayrollRow).filter(PayrollRow.month == month, PayrollRow.pay_type == pay_type).first()
    if not p:
        raise HTTPException(404, detail="Payroll not found")
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == month,
        PayrollRecordRow.pay_type == pay_type,
    ).all()
    records.sort(key=lambda r: _emp_sort_key(r.emp_id))
    return _payroll_dict(p, records)


@app.post("/payrolls/preview")
def preview_payroll(payload: PayrollIn, db: Session = Depends(get_db)):
    return _compute_payroll(payload, db)


@app.post("/payrolls", status_code=201)
def save_payroll(payload: PayrollIn, db: Session = Depends(get_db)):
    if db.query(PayrollRow).filter(
        PayrollRow.month == payload.month, PayrollRow.pay_type == payload.payType
    ).first():
        raise HTTPException(
            400,
            detail=f"Payroll for {payload.month} already exists. Use PUT to overwrite.",
        )
    result = _compute_payroll(payload, db)
    saved_at = datetime.now(timezone.utc).isoformat()
    p = PayrollRow(
        month=payload.month,
        pay_type=payload.payType,
        from_date=payload.fromDate,
        to_date=payload.toDate,
        comp_days=result["compDays"],
        employee_count=result["employeeCount"],
        total_pay=result["totalPay"],
        saved_at=saved_at,
    )
    db.add(p)
    _persist_records(result, db, pay_type=payload.payType)
    db.commit()
    db.refresh(p)
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == payload.month,
        PayrollRecordRow.pay_type == payload.payType,
    ).all()
    records.sort(key=lambda r: _emp_sort_key(r.emp_id))
    return _payroll_dict(p, records)


@app.put("/payrolls/{month}")
def update_payroll(month: str, payload: PayrollIn, db: Session = Depends(get_db)):
    if payload.month != month:
        raise HTTPException(400, detail="month in URL must match payload")
    result = _compute_payroll(payload, db)
    saved_at = datetime.now(timezone.utc).isoformat()
    pt = payload.payType
    p = db.query(PayrollRow).filter(PayrollRow.month == month, PayrollRow.pay_type == pt).first()
    if p:
        p.from_date = payload.fromDate
        p.to_date = payload.toDate
        p.comp_days = result["compDays"]
        p.employee_count = result["employeeCount"]
        p.total_pay = result["totalPay"]
        p.saved_at = saved_at
        db.query(PayrollRecordRow).filter(
            PayrollRecordRow.payroll_month == month,
            PayrollRecordRow.pay_type == pt,
        ).delete()
    else:
        raise HTTPException(404, detail="Payroll not found — use POST to create")
    _persist_records(result, db, pay_type=pt)
    db.commit()
    db.refresh(p)
    records = db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == month,
        PayrollRecordRow.pay_type == pt,
    ).all()
    records.sort(key=lambda r: _emp_sort_key(r.emp_id))
    return _payroll_dict(p, records)


@app.delete("/payrolls/{month}")
def delete_payroll(month: str = Path(pattern=r"^\d{4}-\d{2}$"), pay_type: str = "salary", db: Session = Depends(get_db)):
    p = db.query(PayrollRow).filter(PayrollRow.month == month, PayrollRow.pay_type == pay_type).first()
    if not p:
        raise HTTPException(404, detail="Payroll not found")
    db.query(PayrollRecordRow).filter(
        PayrollRecordRow.payroll_month == month,
        PayrollRecordRow.pay_type == pay_type,
    ).delete()
    db.delete(p)
    db.commit()
    return {"deleted": month}
