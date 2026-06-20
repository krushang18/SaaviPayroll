"""
One-time migration — NOT run automatically, NOT part of the app's lifespan startup.

Splits the existing composite employees.id ("Sr/EmpID", e.g. "02/012") into a plain
Sr. No. (id, primary key) plus a separate Emp ID field, merges employees who are
currently duplicated as separate Day/Night records into a single "Day & Night"
record, and remaps payroll_records.emp_id so current employees' history keeps
resolving after the id is shortened.

Read the printed report carefully before re-running with --commit. By default this
runs as a dry run inside a transaction that is always rolled back, so it is safe to
run repeatedly against production to preview what would change.

Usage:
    pg_dump "$DATABASE_URL" > backup_before_id_split.sql      # take a backup first
    python3 migrate_id_split.py                                # dry run, prints report
    python3 migrate_id_split.py --commit                       # apply for real

Requires DATABASE_URL in the environment (same variable the app uses).
"""
import os
import re
import sys

from sqlalchemy import create_engine, text


def _normalize(part):
    """Strip leading zeros from numeric id segments so "021" and "21" compare equal."""
    if part is None:
        return None
    part = part.strip()
    return str(int(part)) if part.isdigit() else part


def _split_id(raw_id):
    if "/" in raw_id:
        sr, eid = raw_id.split("/", 1)
        return _normalize(sr), _normalize(eid)
    return _normalize(raw_id), None


def _infer_shift_type(name):
    upper = name.upper()
    if "(NIGHT)" in upper:
        return "Night"
    if "(DAY)" in upper:
        return "Day"
    return "Day"  # default for employees with no shift marker in their name


def _find_dual_pairs(employees):
    """Group employees whose normalized Sr. No. OR Emp ID collide with exactly one
    other employee — these are the day/night duplicates of the same person."""
    by_sr, by_eid = {}, {}
    for emp in employees:
        by_sr.setdefault(emp["sr"], []).append(emp)
        if emp["eid"] is not None:
            by_eid.setdefault(emp["eid"], []).append(emp)

    seen_ids = set()
    pairs = []
    for group in list(by_sr.values()) + list(by_eid.values()):
        if len(group) != 2:
            continue
        key = tuple(sorted(e["old_id"] for e in group))
        if key in seen_ids:
            continue
        seen_ids.add(key)
        pairs.append(group)
    return pairs


def main():
    commit = "--commit" in sys.argv
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        sys.exit(1)
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    engine = create_engine(db_url)
    conn = engine.connect()
    trans = conn.begin()
    try:
        rows = conn.execute(text("SELECT id, name, monthly, hourly, working_days, category FROM employees")).fetchall()
        employees = []
        for r in rows:
            sr, eid = _split_id(r.id)
            employees.append({
                "old_id": r.id, "sr": sr, "eid": eid, "name": r.name,
                "monthly": r.monthly, "hourly": r.hourly,
                "working_days": r.working_days, "category": r.category,
            })

        pairs = _find_dual_pairs(employees)
        merged_old_ids = set()
        id_remap = {}   # old employees.id -> new (post-migration) id, for remapping payroll_records.emp_id
        merge_report = []
        skip_report = []

        for pair in pairs:
            a, b = pair
            a_shift, b_shift = _infer_shift_type(a["name"]), _infer_shift_type(b["name"])
            if {a_shift, b_shift} != {"Day", "Night"}:
                skip_report.append(
                    f"  SKIPPED (ambiguous Day/Night marker): {a['old_id']} ({a['name']!r}) "
                    f"vs {b['old_id']} ({b['name']!r}) — merge these manually."
                )
                continue
            day, night = (a, b) if a_shift == "Day" else (b, a)
            new_id = night["sr"]
            new_emp_id = night["eid"]
            merge_report.append(
                f"  MERGE: {day['old_id']} ({day['name']!r}) + {night['old_id']} ({night['name']!r}) "
                f"-> id={new_id}, empId={new_emp_id}, shiftType='Day & Night', "
                f"monthly={day['monthly']}/{day['hourly']} (day), shift2={night['monthly']}/{night['hourly']} (night)"
            )
            merged_old_ids.add(day["old_id"])
            merged_old_ids.add(night["old_id"])
            id_remap[day["old_id"]] = new_id
            id_remap[night["old_id"]] = new_id

            if commit:
                conn.execute(text("""
                    UPDATE employees SET id = :new_id, emp_id = :new_emp_id, name = :name,
                           category = :category, shift_type = 'Day & Night',
                           monthly = :day_monthly, hourly = :day_hourly,
                           shift2_monthly = :night_monthly, shift2_hourly = :night_hourly,
                           working_days = :working_days
                    WHERE id = :old_id
                """), {
                    "new_id": new_id, "new_emp_id": new_emp_id, "name": night["name"],
                    "category": night["category"], "day_monthly": day["monthly"], "day_hourly": day["hourly"],
                    "night_monthly": night["monthly"], "night_hourly": night["hourly"],
                    "working_days": night["working_days"], "old_id": night["old_id"],
                })
                conn.execute(text("DELETE FROM employees WHERE id = :old_id"), {"old_id": day["old_id"]})

        remaining_report = []
        for emp in employees:
            if emp["old_id"] in merged_old_ids:
                continue
            new_id = emp["sr"]
            new_emp_id = emp["eid"]
            shift_type = _infer_shift_type(emp["name"])
            id_remap[emp["old_id"]] = new_id
            remaining_report.append(f"  {emp['old_id']} -> id={new_id}, empId={new_emp_id}, shiftType='{shift_type}'")
            if commit and new_id != emp["old_id"]:
                conn.execute(text("""
                    UPDATE employees SET id = :new_id, emp_id = :new_emp_id, shift_type = :shift_type
                    WHERE id = :old_id
                """), {"new_id": new_id, "new_emp_id": new_emp_id, "shift_type": shift_type, "old_id": emp["old_id"]})
            elif commit:
                conn.execute(text("""
                    UPDATE employees SET emp_id = :new_emp_id, shift_type = :shift_type WHERE id = :old_id
                """), {"new_emp_id": new_emp_id, "shift_type": shift_type, "old_id": emp["old_id"]})

        # Remap payroll_records.emp_id for every old composite id we just changed.
        remap_report = []
        for old_id, new_id in id_remap.items():
            if old_id == new_id:
                continue
            count = conn.execute(
                text("SELECT count(*) FROM payroll_records WHERE emp_id = :old_id"), {"old_id": old_id}
            ).scalar()
            if count:
                remap_report.append(f"  payroll_records: emp_id '{old_id}' -> '{new_id}' ({count} row(s))")
                if commit:
                    conn.execute(
                        text("UPDATE payroll_records SET emp_id = :new_id WHERE emp_id = :old_id"),
                        {"new_id": new_id, "old_id": old_id},
                    )
            count_adv = conn.execute(
                text("SELECT count(*) FROM advances WHERE emp_id = :old_id"), {"old_id": old_id}
            ).scalar()
            if count_adv:
                remap_report.append(f"  advances: emp_id '{old_id}' -> '{new_id}' ({count_adv} row(s))")
                if commit:
                    conn.execute(
                        text("UPDATE advances SET emp_id = :new_id WHERE emp_id = :old_id"),
                        {"new_id": new_id, "old_id": old_id},
                    )

        print("=== Dual-shift merges ===")
        print("\n".join(merge_report) or "  (none)")
        if skip_report:
            print("\n=== Skipped (needs manual review) ===")
            print("\n".join(skip_report))
        print("\n=== Remaining employees (id/empId/shiftType split) ===")
        print("\n".join(remaining_report))
        print("\n=== payroll_records / advances emp_id remap ===")
        print("\n".join(remap_report) or "  (none)")

        if commit:
            dupes = conn.execute(text(
                "SELECT id, count(*) FROM employees GROUP BY id HAVING count(*) > 1"
            )).fetchall()
            if dupes:
                print("\n!! Duplicate ids after migration, rolling back:", dupes, file=sys.stderr)
                trans.rollback()
                sys.exit(1)
            trans.commit()
            print("\nCommitted.")
        else:
            print("\nDRY RUN — no changes written. Re-run with --commit to apply.")
            trans.rollback()
    except Exception:
        trans.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
