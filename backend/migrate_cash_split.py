"""
One-time migration — NOT run automatically, NOT part of the app's lifespan startup.

Splits cash employees (and their advances / advance settlements) out of the shared
salary tables into dedicated cash tables, so salary and cash have independent id
namespaces (salary "11" and cash "11" can coexist):

    employees            (pay_type='cash')  ->  cash_employees
    advances             (cash employees)   ->  cash_advances
    advance_settlements  (cash employees)   ->  cash_advance_settlements

payrolls / payroll_records are left untouched — they already carry a pay_type
column and are correctly scoped.

Cash advances/settlements are identified by emp_id IN (cash employee ids). This is
unambiguous because, before this split, employees.id is globally unique (a cash
employee sharing an id with a salary employee was impossible — that collision is the
exact bug this migration fixes).

By default this runs as a DRY RUN inside a transaction that is always rolled back, so
it is safe to run repeatedly against production to preview what would change.

Usage:
    pg_dump "$DATABASE_URL" > backup_before_cash_split.sql    # take a backup first
    python3 migrate_cash_split.py                              # dry run, prints report
    python3 migrate_cash_split.py --commit                     # apply for real

Requires DATABASE_URL in the environment (same variable the app uses).
"""
import os
import sys

from sqlalchemy import create_engine, text, bindparam

# Reuse the app's models so the new cash tables are byte-for-byte identical to the
# salary ones (same columns, types, indexes, and their own independent sequences).
from main import (
    Base,
    EmployeeRow, CashEmployeeRow,
    AdvanceRow, CashAdvanceRow,
    AdvanceSettlementRow, CashAdvanceSettlementRow,
)

# (source table, destination table, ORM model) — model gives us the shared column list.
MOVES = [
    (EmployeeRow.__tablename__,          CashEmployeeRow.__tablename__,          CashEmployeeRow),
    (AdvanceRow.__tablename__,           CashAdvanceRow.__tablename__,           CashAdvanceRow),
    (AdvanceSettlementRow.__tablename__, CashAdvanceSettlementRow.__tablename__, CashAdvanceSettlementRow),
]


def _cols(model):
    """Explicit column-name list so INSERT ... SELECT never relies on physical column
    order (prod columns were added incrementally via ALTER and may be ordered
    differently from the freshly-created cash table)."""
    return [c.name for c in model.__table__.columns]


def main():
    commit = "--commit" in sys.argv
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        sys.exit(1)
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    engine = create_engine(db_url)

    # Create the cash tables up front (idempotent, own sequences). Harmless on a dry
    # run — they are created empty and only populated under --commit.
    Base.metadata.create_all(engine, tables=[m.__table__ for _, _, m in MOVES])

    conn = engine.connect()
    trans = conn.begin()
    try:
        cash_ids = [r[0] for r in conn.execute(
            text("SELECT id FROM employees WHERE pay_type = 'cash'")
        ).fetchall()]

        ids_bp = bindparam("ids", expanding=True)

        def count_for(table):
            return conn.execute(
                text(f"SELECT count(*) FROM {table} WHERE emp_id IN :ids").bindparams(ids_bp),
                {"ids": cash_ids},
            ).scalar()

        emp_n = len(cash_ids)
        adv_n = count_for("advances") if cash_ids else 0
        set_n = count_for("advance_settlements") if cash_ids else 0

        print("=== Cash split — rows to move ===")
        print(f"  cash_employees           <- employees (pay_type='cash')   : {emp_n}")
        print(f"  cash_advances            <- advances (cash employees)     : {adv_n}")
        print(f"  cash_advance_settlements <- advance_settlements (cash)     : {set_n}")
        if cash_ids:
            print(f"  cash employee ids: {', '.join(sorted(cash_ids))}")

        if not commit:
            print("\nDRY RUN — no changes written. Re-run with --commit to apply.")
            trans.rollback()
            return

        if emp_n == 0:
            print("\nNo cash employees to migrate. Cash tables created (empty). Done.")
            trans.commit()
            return

        # 1. Copy cash rows into the dedicated tables (explicit column lists).
        emp_cols = ", ".join(_cols(CashEmployeeRow))
        conn.execute(text(
            f"INSERT INTO cash_employees ({emp_cols}) "
            f"SELECT {emp_cols} FROM employees WHERE pay_type = 'cash'"
        ))
        adv_cols = ", ".join(_cols(CashAdvanceRow))
        conn.execute(text(
            f"INSERT INTO cash_advances ({adv_cols}) "
            f"SELECT {adv_cols} FROM advances WHERE emp_id IN :ids"
        ).bindparams(ids_bp), {"ids": cash_ids})
        set_cols = ", ".join(_cols(CashAdvanceSettlementRow))
        conn.execute(text(
            f"INSERT INTO cash_advance_settlements ({set_cols}) "
            f"SELECT {set_cols} FROM advance_settlements WHERE emp_id IN :ids"
        ).bindparams(ids_bp), {"ids": cash_ids})

        # 2. Remove the moved rows from the salary tables.
        conn.execute(text("DELETE FROM advances WHERE emp_id IN :ids").bindparams(ids_bp), {"ids": cash_ids})
        conn.execute(text("DELETE FROM advance_settlements WHERE emp_id IN :ids").bindparams(ids_bp), {"ids": cash_ids})
        conn.execute(text("DELETE FROM employees WHERE pay_type = 'cash'"))

        # 3. Verify before committing.
        checks = {
            "cash_employees count == moved":
                conn.execute(text("SELECT count(*) FROM cash_employees")).scalar() == emp_n,
            "cash_advances count == moved":
                conn.execute(text("SELECT count(*) FROM cash_advances")).scalar() == adv_n,
            "cash_advance_settlements count == moved":
                conn.execute(text("SELECT count(*) FROM cash_advance_settlements")).scalar() == set_n,
            "no cash employees left in employees":
                conn.execute(text("SELECT count(*) FROM employees WHERE pay_type='cash'")).scalar() == 0,
            "no cash advances left in advances":
                conn.execute(text("SELECT count(*) FROM advances WHERE emp_id IN :ids")
                             .bindparams(ids_bp), {"ids": cash_ids}).scalar() == 0,
            "no cash settlements left in advance_settlements":
                conn.execute(text("SELECT count(*) FROM advance_settlements WHERE emp_id IN :ids")
                             .bindparams(ids_bp), {"ids": cash_ids}).scalar() == 0,
        }
        print("\n=== Verification ===")
        for label, ok in checks.items():
            print(f"  [{'OK' if ok else 'FAIL'}] {label}")
        if not all(checks.values()):
            print("\n!! Verification failed — rolling back, nothing was changed.", file=sys.stderr)
            trans.rollback()
            sys.exit(1)

        trans.commit()
        print("\nCommitted.")
    except Exception:
        trans.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
