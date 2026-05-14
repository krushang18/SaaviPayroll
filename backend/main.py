from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import json, os, math, uuid
from datetime import datetime, date

app = FastAPI(title="Saavi Payroll API", version="2.0.0")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
EMP_FILE = os.path.join(DATA_DIR, "employees.json")
PAYROLLS_DIR = os.path.join(DATA_DIR, "payrolls")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PAYROLLS_DIR, exist_ok=True)


def _read(path: str, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: str, data) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# Seed real employees on first run
if not os.path.exists(EMP_FILE):
    _write(EMP_FILE, [
        {"id": "4",    "name": "Sujal",                 "monthly": 9360,  "hourly": 52, "workingDays": 27},
        {"id": "42",   "name": "Sarla (N)",              "monthly": 20640, "hourly": 64, "workingDays": 27},
        {"id": "53",   "name": "Rekha Sis",              "monthly": 12000, "hourly": 79, "workingDays": 30},
        {"id": "76",   "name": "Jayshri",                "monthly": 14100, "hourly": 79, "workingDays": 27},
        {"id": "77",   "name": "Payal",                  "monthly": 18150, "hourly": 60, "workingDays": 27},
        {"id": "84",   "name": "Nanda (N)",              "monthly": 14000, "hourly": 38, "workingDays": 27},
        {"id": "87",   "name": "Nanda (D)",              "monthly": 8900,  "hourly": 49, "workingDays": 27},
        {"id": "96",   "name": "Gangamasi 27",           "monthly": 11500, "hourly": 48, "workingDays": 28},
        {"id": "98",   "name": "Koki (D)",               "monthly": 9750,  "hourly": 50, "workingDays": 28},
        {"id": "102",  "name": "Kankuben",               "monthly": 10500, "hourly": 29, "workingDays": 30},
        {"id": "107",  "name": "Binaben",                "monthly": 17500, "hourly": 48, "workingDays": 30},
        {"id": "107B", "name": "Dimple",                 "monthly": 11500, "hourly": 58, "workingDays": 28},
        {"id": "122",  "name": "Subhdra",                "monthly": 13500, "hourly": 64, "workingDays": 28},
        {"id": "116",  "name": "Neelam (Old)",           "monthly": 13130, "hourly": 62, "workingDays": 28},
        {"id": "117",  "name": "Maharani (Dakhuben)",    "monthly": 9000,  "hourly": 40, "workingDays": 30},
        {"id": "118",  "name": "Khushbudi",              "monthly": 6800,  "hourly": 29, "workingDays": 30},
        {"id": "119",  "name": "Amrutbhai (D)",          "monthly": 13200, "hourly": 40, "workingDays": 29},
        {"id": "119B", "name": "Amrutbhai (N)",          "monthly": 12100, "hourly": 33, "workingDays": 21},
        {"id": "125",  "name": "Harjilal",               "monthly": 11000, "hourly": 40, "workingDays": 30},
        {"id": "126",  "name": "Sunita",                 "monthly": 9350,  "hourly": 51, "workingDays": 30},
    ])


# ── Models ───────────────────────────────────────────────────────────────────

class Employee(BaseModel):
    id: str
    name: str
    monthly: float
    hourly: float
    workingDays: int = 30


class PayrollEntry(BaseModel):
    empId: str
    presentDays: Optional[float] = None
    absentDays: Optional[float] = None
    extraHours: float = 0
    debitAmount: float = 0


class PayrollIn(BaseModel):
    month: str       # "2026-04"
    fromDate: str    # "2026-03-26"
    toDate: str      # "2026-04-25"
    entries: List[PayrollEntry]


# ── Payroll logic (exact mirror of frontend computeSalary) ────────────────────
#
# daily   = floor(monthly / 30)
# diff    = floor(present) - workingDays
# dayAdj  = diff * daily
# basePay = monthly + dayAdj
# otPay   = extraHours * hourly
# total   = basePay + otPay
#
# Employee rates (monthly, hourly, workingDays) are snapshotted at save time
# so historical records remain unchanged when employee data is updated later.

def _period_days(from_date: str, to_date: str) -> int:
    d1 = date.fromisoformat(from_date)
    d2 = date.fromisoformat(to_date)
    return (d2 - d1).days + 1


def _calc_record(emp: dict, fromDate: str, toDate: str,
                 presentDays: Optional[float], absentDays: Optional[float],
                 extraHours: float, debitAmount: float = 0) -> dict:
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
    total = basePay + otPay - debitAmount

    return {
        "empId":        emp["id"],
        "empName":      emp["name"],
        # Snapshot rates at save time — persists even if employee record changes later
        "monthly":      emp["monthly"],
        "daily":        daily,
        "hourly":       emp["hourly"],
        "workingDays":  wd,
        # Attendance
        "periodDays":   pd,
        "presentDays":  present,
        "absentDays":   absent,
        "compDays":     comp_days,
        "extraHours":   extraHours,
        # Computed (diff uses effective present = present + compDays)
        "diff":         diff,
        "dayAdj":       dayAdj,
        "basePay":      basePay,
        "otPay":        otPay,
        "debitAmount":  debitAmount,
        "total":        total,
    }


def _compute_payroll(payload: PayrollIn) -> dict:
    emps = _read(EMP_FILE, [])
    emp_map = {e["id"]: e for e in emps}

    records = []
    errors = []
    for entry in payload.entries:
        emp = emp_map.get(entry.empId)
        if not emp:
            errors.append(f"Employee {entry.empId} not found")
            continue
        try:
            rec = _calc_record(emp, payload.fromDate, payload.toDate,
                               entry.presentDays, entry.absentDays, entry.extraHours, entry.debitAmount)
            records.append(rec)
        except ValueError as e:
            errors.append(str(e))

    if errors:
        raise HTTPException(400, detail="; ".join(errors))

    total_pay = sum(r["total"] for r in records)
    comp_days = max(0, 30 - _period_days(payload.fromDate, payload.toDate))
    return {
        "month":         payload.month,
        "fromDate":      payload.fromDate,
        "toDate":        payload.toDate,
        "compDays":      comp_days,
        "employeeCount": len(records),
        "totalPay":      total_pay,
        "records":       records,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "service": "Saavi Payroll API v2"}


# ── Employees ─────────────────────────────────────────────────────────────────

@app.get("/employees")
def list_employees():
    return _read(EMP_FILE, [])


@app.post("/employees", status_code=201)
def create_employee(emp: Employee):
    emps = _read(EMP_FILE, [])
    if any(e["id"] == emp.id for e in emps):
        raise HTTPException(400, detail="Employee ID already exists")
    emps.append(emp.model_dump())
    _write(EMP_FILE, emps)
    return emp.model_dump()


@app.put("/employees/{emp_id}")
def update_employee(emp_id: str, emp: Employee):
    emps = _read(EMP_FILE, [])
    idx = next((i for i, e in enumerate(emps) if e["id"] == emp_id), None)
    if idx is None:
        raise HTTPException(404, detail="Employee not found")
    emps[idx] = emp.model_dump()
    _write(EMP_FILE, emps)
    return emps[idx]


@app.delete("/employees/{emp_id}")
def delete_employee(emp_id: str):
    emps = _read(EMP_FILE, [])
    if not any(e["id"] == emp_id for e in emps):
        raise HTTPException(404, detail="Employee not found")
    _write(EMP_FILE, [e for e in emps if e["id"] != emp_id])
    return {"deleted": emp_id}


# ── Payrolls (one JSON file per month in data/payrolls/) ─────────────────────

def _payroll_path(month: str) -> str:
    return os.path.join(PAYROLLS_DIR, f"{month}.json")


def _list_payroll_months() -> list:
    try:
        return sorted(
            [f[:-5] for f in os.listdir(PAYROLLS_DIR) if f.endswith(".json")],
            reverse=True,
        )
    except FileNotFoundError:
        return []


@app.get("/payrolls")
def list_payrolls():
    """Returns full payroll objects (including records) for all saved months."""
    result = []
    for month in _list_payroll_months():
        data = _read(_payroll_path(month), None)
        if data:
            result.append(data)
    return result


@app.get("/payrolls/{month}")
def get_payroll(month: str):
    data = _read(_payroll_path(month), None)
    if data is None:
        raise HTTPException(404, detail="Payroll not found")
    return data


@app.post("/payrolls/preview")
def preview_payroll(payload: PayrollIn):
    """Calculate without saving — used for live preview."""
    return _compute_payroll(payload)


@app.post("/payrolls", status_code=201)
def save_payroll(payload: PayrollIn):
    path = _payroll_path(payload.month)
    if os.path.exists(path):
        raise HTTPException(
            400,
            detail=f"Payroll for {payload.month} already exists. Use PUT to overwrite."
        )
    result = _compute_payroll(payload)
    result["savedAt"] = datetime.utcnow().isoformat()
    _write(path, result)
    return result


@app.put("/payrolls/{month}")
def update_payroll(month: str, payload: PayrollIn):
    result = _compute_payroll(payload)
    result["savedAt"] = datetime.utcnow().isoformat()
    _write(_payroll_path(month), result)
    return result


@app.delete("/payrolls/{month}")
def delete_payroll(month: str):
    path = _payroll_path(month)
    if not os.path.exists(path):
        raise HTTPException(404, detail="Payroll not found")
    os.remove(path)
    return {"deleted": month}
