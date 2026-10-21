"""Deterministic demonstration ledger; monetary amounts are whole USD."""
import calendar
import json
import math
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "finance.sqlite3"
BUS = ["Corporate", "Operations", "Sales & Marketing", "Technology"]
ACCOUNTS = ["Revenue", "COGS", "Salaries & Benefits", "Contractors", "Travel",
            "Software & Licences", "Facilities", "Marketing", "Professional Fees", "Depreciation"]
CENTRES = [
    ["Finance", "People & Culture", "Legal & Governance"],
    ["Service Delivery", "Supply Chain", "Customer Success"],
    ["Enterprise Sales", "Growth Marketing", "Partnerships"],
    ["Engineering", "Infrastructure", "Product & Data"],
]
BASE = [
    [60000, 12000, 440000, 65000, 18000, 38000, 85000, 12000, 105000, 30000],
    [6000000, 3000000, 1100000, 160000, 30000, 40000, 180000, 10000, 25000, 95000],
    [5500000, 950000, 700000, 65000, 90000, 65000, 55000, 430000, 35000, 15000],
    [440000, 100000, 950000, 320000, 18000, 260000, 65000, 5000, 30000, 80000],
]


def connect():
    db = sqlite3.connect(DB_PATH, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def seed():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS business_units(id INTEGER PRIMARY KEY, name TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS cost_centres(id INTEGER PRIMARY KEY, name TEXT, bu_id INTEGER REFERENCES business_units);
        CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, name TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS ledger(
          id INTEGER PRIMARY KEY, year INTEGER, month INTEGER, scenario TEXT,
          cc_id INTEGER REFERENCES cost_centres, account_id INTEGER REFERENCES accounts,
          amount INTEGER, UNIQUE(year,month,scenario,cc_id,account_id));
        CREATE VIEW IF NOT EXISTS budget AS SELECT * FROM ledger WHERE scenario='budget';
        CREATE VIEW IF NOT EXISTS actuals AS SELECT * FROM ledger WHERE scenario='actual';
        CREATE VIEW IF NOT EXISTS latest_forecast AS SELECT * FROM ledger WHERE scenario='forecast';
        CREATE VIEW IF NOT EXISTS prior_year_actuals AS SELECT * FROM ledger WHERE scenario='prior';
        CREATE TABLE IF NOT EXISTS kpis(
          year INTEGER, month INTEGER, scenario TEXT, headcount INTEGER, customers INTEGER,
          PRIMARY KEY(year,month,scenario));
        CREATE TABLE IF NOT EXISTS drivers(
          bu_id INTEGER, account_id INTEGER, first_month INTEGER, last_month INTEGER,
          classification TEXT, explanation TEXT);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT);
        CREATE TABLE IF NOT EXISTS commentary(
          id INTEGER PRIMARY KEY, month INTEGER, view TEXT, comparison TEXT, section TEXT,
          title TEXT, status TEXT, audience TEXT, sentences TEXT, engine TEXT, updated_at TEXT,
          UNIQUE(month,view,comparison,section,audience));
        """)
        if db.execute("SELECT count(*) FROM ledger").fetchone()[0]:
            return
        for b, name in enumerate(BUS):
            db.execute("INSERT INTO business_units VALUES (?,?)", (b, name))
            for c, centre in enumerate(CENTRES[b]):
                db.execute("INSERT INTO cost_centres VALUES (?,?,?)", (b * 3 + c, centre, b))
        db.executemany("INSERT INTO accounts VALUES (?,?)", enumerate(ACCOUNTS))
        for month in range(1, 13):
            seasonal = 1 + .018 * (month - 1) + .025 * math.sin(month / 12 * math.tau)
            for b in range(4):
                for a in range(10):
                    plan = BASE[b][a] * (seasonal if a < 2 else 1 + .004 * (month - 1))
                    for scenario in ["budget", "actual", "forecast", "prior"]:
                        if scenario == "actual" and month > 9:
                            continue
                        value = plan
                        if scenario == "prior":
                            value = plan / (1.09 if a == 0 else 1.06)
                        elif scenario == "actual":
                            value *= (.969 + .004 * math.sin(month)) if a == 0 else (.99 + .012 * math.sin(month + a + b))
                            if b == 3 and a == 3 and month >= 4:
                                value += 185000 + month * 2500
                            if b == 2 and a == 7 and month == 9:
                                value += 210000
                            if b == 0 and a == 8 and month == 9:
                                value += 145000
                        elif scenario == "forecast":
                            value *= .975 if a == 0 else 1.005
                            if b == 3 and a == 3 and month >= 4:
                                value += 180000
                            if b == 2 and a == 7 and month == 9:
                                value += 210000
                            if b == 2 and a == 7 and month == 10:
                                value -= 210000
                            if b == 0 and a == 8 and month == 9:
                                value += 120000
                        total = round(value)
                        allocations = [round(total * .46), round(total * .33)]
                        allocations.append(total - sum(allocations))
                        for c, amount in enumerate(allocations):
                            db.execute("INSERT INTO ledger(year,month,scenario,cc_id,account_id,amount) VALUES(?,?,?,?,?,?)",
                                       (2025 if scenario == "prior" else 2026, month, scenario, b * 3 + c, a, amount))
            for scenario in ["budget", "actual", "forecast", "prior"]:
                if scenario == "actual" and month > 9:
                    continue
                hc = 448 + month * 3 + {"budget": 8, "actual": 0, "forecast": 3, "prior": -25}[scenario]
                customers = 1180 + month * 24 + {"budget": 30, "actual": -12, "forecast": 0, "prior": -125}[scenario]
                db.execute("INSERT INTO kpis VALUES(?,?,?,?,?)", (2025 if scenario == "prior" else 2026, month, scenario, hc, customers))
        db.executemany("INSERT INTO drivers VALUES(?,?,?,?,?,?)", [
            (3, 3, 4, 12, "Run-rate", "Specialist contractors support the platform migration; the additional capacity is expected to continue through year-end."),
            (2, 7, 9, 9, "Timing", "The autumn campaign was brought forward from October into September; the latest forecast includes the offset in October."),
            (0, 8, 9, 9, "One-time", "External legal and advisory fees relate to a completed corporate restructuring."),
            (-1, 0, 1, 12, "Run-rate", "Slower enterprise deal conversion and a softer sales mix leave revenue below plan."),
        ])
        db.execute("INSERT INTO settings VALUES(1,?)", (json.dumps({"percentThreshold": 5, "amountThreshold": 50000, "audience": "CFO"}),))


def settings():
    with connect() as db:
        return json.loads(db.execute("SELECT payload FROM settings WHERE id=1").fetchone()[0])


def month_name(month):
    return calendar.month_name[month]
