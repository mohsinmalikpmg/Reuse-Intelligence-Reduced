"""Narrow transformation only: original engines own projection and aggregation."""
from decimal import Decimal

ACCOUNTS = ["Revenue", "COGS", "Salaries & Benefits", "Contractors", "Travel",
            "Software & Licences", "Facilities", "Marketing", "Professional Fees", "Depreciation"]
CENTRES = {"Service Delivery": 3, "Supply Chain": 4}
FIELDS = {"businessUnit", "costCentre", "account", "month", "q3", "actual", "budget", "q2"}


def validate_adjustment(value):
    if type(value) not in (int, float) or not Decimal(str(value)).is_finite():
        raise ValueError("Adjustment must be a finite number.")
    if value != int(value) or not -600 <= value <= 6000 or value % 6:
        raise ValueError("Enter a whole-dollar multiple of 6 between -600 and 6000.")
    return int(value)


def dollars_to_cents(value):
    if type(value) not in (int, float, Decimal):
        raise ValueError("A monetary value is missing or invalid.")
    amount = Decimal(str(value))
    if not amount.is_finite() or amount * 100 != (amount * 100).to_integral_value():
        raise ValueError("Amounts must have at most two decimal places.")
    return int(amount * 100)


def dollars(cents):
    return format(Decimal(cents) / 100, ".2f")


def adapt_rows(rows, centres=None, account_mapping=None):
    """Validate the complete supported grain before any write; never fill missing data."""
    centres = CENTRES if centres is None else centres
    account_mapping = {name: i for i, name in enumerate(ACCOUNTS)} if account_mapping is None else account_mapping
    converted, seen = [], set()
    for row in rows:
        if not FIELDS <= row.keys():
            raise ValueError("Forecast row is missing required fields.")
        if row["costCentre"] not in centres or row["businessUnit"] != "Operations":
            raise ValueError("Unmapped cost centre or business unit.")
        if row["account"] not in ACCOUNTS:
            raise ValueError("Unmapped account.")
        month = row["month"]
        if type(month) is not int or not 1 <= month <= 12:
            raise ValueError("Invalid FY2026 month.")
        key = (row["costCentre"], row["account"], month)
        if key in seen:
            raise ValueError("Duplicate forecast grain.")
        seen.add(key)
        for field in ("q3", "budget", "q2"):
            dollars_to_cents(row[field])
        if month <= 9:
            if dollars_to_cents(row["actual"]) != dollars_to_cents(row["q3"]):
                raise ValueError("Closed-month actuals must remain unchanged.")
        elif row["actual"] is not None:
            raise ValueError("Future actuals must be missing, not zero.")
        converted.append((2026, month, "forecast", CENTRES[row["costCentre"]],
                          account_mapping[row["account"]], dollars_to_cents(row["q3"])))
    expected = {(cc, account, month) for cc in centres for account in ACCOUNTS for month in range(1, 13)}
    if seen != expected:
        raise ValueError("Incomplete forecast grid; missing data cannot be treated as zero.")
    return converted


def replace_forecast(connection, rows, centres=None, account_mapping=None):
    converted = adapt_rows(rows, centres, account_mapping)
    with connection:
        connection.execute("DELETE FROM ledger WHERE scenario='forecast'")
        connection.executemany(
            """INSERT INTO ledger(year,month,scenario,cc_id,account_id,amount) VALUES(?,?,?,?,?,?)
            ON CONFLICT(year,month,scenario,cc_id,account_id)
            DO UPDATE SET amount=ledger.amount+excluded.amount""", converted)
