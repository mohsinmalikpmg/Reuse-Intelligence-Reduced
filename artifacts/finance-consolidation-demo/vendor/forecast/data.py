"""Deterministic FY2026 demo ledger. Amounts are stored as integer cents."""
import math
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("BUDGET_DB_PATH", str(Path(__file__).parent / "budget.sqlite3")))
ACCOUNTS = ["Revenue", "COGS", "Salaries & Benefits", "Contractors", "Travel",
            "Software & Licences", "Facilities", "Marketing", "Professional Fees", "Depreciation"]
CENTRES = {
    "Corporate": ["Finance & Legal", "People & Culture", "Executive Office"],
    "Operations": ["Service Delivery", "Supply Chain", "Customer Success"],
    "Sales & Marketing": ["Enterprise Sales", "Growth Marketing", "Brand & Communications"],
    "Technology": ["Engineering", "IT Infrastructure", "Product & Data"],
}


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def initialize():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS cost_centres(name TEXT PRIMARY KEY, business_unit TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts(name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS budget(cost_centre TEXT REFERENCES cost_centres(name), account TEXT REFERENCES accounts(name),
          month INTEGER CHECK(month BETWEEN 1 AND 12), amount INTEGER NOT NULL,
          PRIMARY KEY(cost_centre,account,month));
        CREATE TABLE IF NOT EXISTS actuals(cost_centre TEXT REFERENCES cost_centres(name), account TEXT REFERENCES accounts(name),
          month INTEGER CHECK(month BETWEEN 1 AND 9), amount INTEGER NOT NULL,
          PRIMARY KEY(cost_centre,account,month));
        CREATE TABLE IF NOT EXISTS forecast(version TEXT, cost_centre TEXT REFERENCES cost_centres(name),
          account TEXT REFERENCES accounts(name), month INTEGER CHECK(month BETWEEN 1 AND 12), amount INTEGER NOT NULL,
          PRIMARY KEY(version,cost_centre,account,month));
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), percent_threshold REAL, dollar_threshold REAL);
        CREATE TABLE IF NOT EXISTS risks(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL,
          type TEXT NOT NULL, costCentre TEXT NOT NULL, owner TEXT NOT NULL, impact REAL NOT NULL,
          status TEXT NOT NULL, source TEXT NOT NULL);
        INSERT OR IGNORE INTO settings VALUES(1,5,50000);
        """)
        if db.execute("SELECT COUNT(*) FROM budget").fetchone()[0]:
            return
        for ai, a in enumerate(ACCOUNTS):
            db.execute("INSERT INTO accounts VALUES(?)", (a,))
        for bi, (bu, centres) in enumerate(CENTRES.items()):
            for ci, cc in enumerate(centres):
                db.execute("INSERT INTO cost_centres VALUES(?,?)", (cc, bu))
                for ai, a in enumerate(ACCOUNTS):
                    bases = [0, 18000, 108000, 14000, 6500, 11500, 12000, 4500, 7000, 6000]
                    base = bases[ai] * (0.8 + ci * 0.2)
                    if a == "Revenue":
                        base = (530000 if bi == 1 else 760000 if bi == 2 else 0) * (1 + ci * .12)
                    if a == "COGS":
                        base = (185000 if bi == 1 else 45000 if bi == 2 else 0) * (1 + ci * .12)
                    if a == "Contractors" and bi == 3:
                        base *= 3.3
                    if a == "Salaries & Benefits" and bi == 3:
                        base *= 1.5
                    if a == "Marketing" and bi == 2:
                        base *= 12
                    for m in range(1, 13):
                        season = 1 + .04 * math.sin(m * .6 + ai) + (.025 * (m - 1) if a == "Revenue" else 0)
                        b = round(base * season * 100)
                        factor = 1 + .012 * math.sin(m * 1.3 + ci + bi)
                        if a == "Revenue":
                            factor = .965 + .008 * math.sin(m)
                        if a == "Contractors" and bi == 3:
                            factor = 1.25 + .025 * m
                        if a == "Salaries & Benefits" and bi == 1:
                            factor = .96
                        actual = round(b * factor)
                        if a == "Marketing" and bi == 2:
                            actual += int((-26000 if m in (7, 8, 9) else 0) * 100)
                        if a == "Professional Fees" and cc == "Finance & Legal" and m == 6:
                            actual += 18000000
                        db.execute("INSERT INTO budget VALUES(?,?,?,?)", (cc, a, m, b))
                        if m <= 9:
                            db.execute("INSERT INTO actuals VALUES(?,?,?,?)", (cc, a, m, actual))
                        for version, cutoff in [("Q2 Forecast", 6), ("Q3 Forecast", 9)]:
                            if m <= cutoff:
                                f = actual
                            else:
                                f = b
                                if a == "Revenue":
                                    f = round(b * (.985 if cutoff == 6 else .965))
                                if a == "Contractors" and bi == 3:
                                    f = round(b * (1.30 if cutoff == 6 else 1.50))
                                if a == "Salaries & Benefits" and bi == 1:
                                    f = round(b * .96)
                                if a == "Marketing" and bi == 2 and cutoff == 9:
                                    f += 2600000
                            db.execute("INSERT INTO forecast VALUES(?,?,?,?,?)", (version, cc, a, m, f))
        # Seed register from actual forecast deltas, not independent invented figures.
        records = db.execute("""
          SELECT b.cost_centre, c.business_unit, b.account, SUM(f.amount-b.amount)/100.0 delta
          FROM budget b JOIN cost_centres c ON c.name=b.cost_centre
          JOIN forecast f ON f.cost_centre=b.cost_centre AND f.account=b.account
            AND f.month=b.month AND f.version='Q3 Forecast'
          GROUP BY b.cost_centre,b.account HAVING ABS(SUM(f.amount-b.amount))>2000000
          ORDER BY ABS(SUM(f.amount-b.amount)) DESC
        """).fetchall()
        for r in records:
            adverse = r["delta"] < 0 if r["account"] == "Revenue" else r["delta"] > 0
            driver = classify(r["business_unit"], r["cost_centre"], r["account"])
            db.execute("""INSERT INTO risks(title,description,type,costCentre,owner,impact,status,source)
              VALUES(?,?,?,?,?,?,?,?)""", (
                f'{r["account"]}: {r["cost_centre"]}',
                f'Q3 full-year forecast vs budget. Likely driver: {driver}. Validate with the cost-centre owner.',
                "Risk" if adverse else "Opportunity", r["cost_centre"], "", abs(round(r["delta"], 2)), "Open", "Auto-generated"))


def classify(bu, cc, account):
    if account == "Marketing" and bu == "Sales & Marketing":
        return "timing"
    if account == "Professional Fees" and cc == "Finance & Legal":
        return "one-time"
    return "run-rate"


def rows():
    with connect() as db:
        result = db.execute("""
        SELECT c.business_unit businessUnit,b.cost_centre costCentre,b.account,b.month,
          b.amount/100.0 budget,a.amount/100.0 actual,q2.amount/100.0 q2,q3.amount/100.0 q3
        FROM budget b JOIN cost_centres c ON c.name=b.cost_centre
        LEFT JOIN actuals a ON a.cost_centre=b.cost_centre AND a.account=b.account AND a.month=b.month
        JOIN forecast q2 ON q2.cost_centre=b.cost_centre AND q2.account=b.account AND q2.month=b.month AND q2.version='Q2 Forecast'
        JOIN forecast q3 ON q3.cost_centre=b.cost_centre AND q3.account=b.account AND q3.month=b.month AND q3.version='Q3 Forecast'
        ORDER BY c.business_unit,b.cost_centre,b.account,b.month
        """).fetchall()
    return [dict(r, driver=classify(r["businessUnit"], r["costCentre"], r["account"])) for r in result]


def settings():
    with connect() as db:
        r = db.execute("SELECT * FROM settings WHERE id=1").fetchone()
    return {"percentThreshold": r["percent_threshold"], "dollarThreshold": r["dollar_threshold"]}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Seed finance demo data")
    parser.add_argument("--reset", action="store_true", help="Deletes ALL demo data, register edits and settings")
    args = parser.parse_args()
    if args.reset and DB_PATH.exists():
        DB_PATH.unlink()
    initialize()
