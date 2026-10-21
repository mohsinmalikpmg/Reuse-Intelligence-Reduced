"""Synthetic fixtures only. Both source schema initializers run in temporary databases."""
from .adapter import ACCOUNTS, CENTRES

# Exact cents per month; pennies intentionally exercise precision.
MONTHLY = {
    "Service Delivery": [1000001, 200000, 300000, 100001, 0, 0, 0, 0, 0, 0],
    "Supply Chain": [2000002, 400000, 600000, 200002, 0, 0, 0, 0, 0, 0],
}


def initialize(forecast_data, reporting_data):
    forecast_data.initialize()
    reporting_data.seed()
    with forecast_data.connect() as db:
        for table in ("budget", "actuals", "forecast", "risks"):
            db.execute(f"DELETE FROM {table}")  # fixed allowlist, synthetic temp DB only
        for centre, amounts in MONTHLY.items():
            for account, amount in zip(ACCOUNTS, amounts):
                for month in range(1, 13):
                    db.execute("INSERT INTO budget VALUES(?,?,?,?)", (centre, account, month, amount))
                    if month <= 9:
                        db.execute("INSERT INTO actuals VALUES(?,?,?,?)", (centre, account, month, amount))
                    for version in ("Q2 Forecast", "Q3 Forecast"):
                        db.execute("INSERT INTO forecast VALUES(?,?,?,?,?)", (version, centre, account, month, amount))
    with reporting_data.connect() as db:
        for table in ("ledger", "kpis", "drivers", "commentary"):
            db.execute(f"DELETE FROM {table}")
        # Assert identity, not fuzzy name/position matching.
        for name, ident in CENTRES.items():
            row = db.execute("SELECT name,bu_id FROM cost_centres WHERE id=?", (ident,)).fetchone()
            if tuple(row) != (name, 1):
                raise ValueError("Reviewed cost-centre mapping no longer matches source.")
        if [r["name"] for r in db.execute("SELECT name FROM accounts ORDER BY id")] != ACCOUNTS:
            raise ValueError("Reviewed account mapping no longer matches source.")
