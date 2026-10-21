import base64
import calendar
import json
from .data import connect, settings, BUS, ACCOUNTS, month_name


def source_id(month, view, account="all", bu=-1, kind="ledger"):
    return base64.urlsafe_b64encode(json.dumps([month, view, account, bu, kind], separators=(",", ":")).encode()).decode().rstrip("=")


def source_context(sid):
    try:
        context = json.loads(base64.urlsafe_b64decode(sid + "=" * (-len(sid) % 4)))
        m, v, a, b, k = context
        if not isinstance(m, int) or not 1 <= m <= 12 or v not in ["month", "ytd"] or b not in range(-1, 4):
            raise ValueError()
        if a not in [*range(10), "all", "opex", "profit", "gross"] or k not in ["ledger", "kpi"]:
            raise ValueError()
        return m, v, a, b, k
    except Exception:
        raise ValueError("Invalid source reference")


def account_ids(account):
    if isinstance(account, int):
        return [account]
    if account == "opex":
        return list(range(2, 10))
    if account == "gross":
        return [0, 1]
    return list(range(10))


def totals(month, view, account="all", bu=-1):
    ids = account_ids(account)
    start = 1 if view == "ytd" else month
    with connect() as db:
        rows = db.execute(f"""SELECT l.scenario,l.account_id,sum(l.amount) amount
        FROM ledger l JOIN cost_centres c ON c.id=l.cc_id
        WHERE month BETWEEN ? AND ? AND account_id IN ({','.join('?' for _ in ids)})
        AND (?=-1 OR c.bu_id=?) GROUP BY scenario,account_id""", [start, month, *ids, bu, bu]).fetchall()
    result = dict(actual=0, budget=0, forecast=0, prior=0)
    for row in rows:
        sign = -1 if account in ["profit", "gross"] and row["account_id"] != 0 else 1
        result[row["scenario"]] += row["amount"] * sign
    return result


def financial_row(month, view, comparison, account, bu=-1, name=None):
    values = totals(month, view, account, bu)
    delta = values["actual"] - values[comparison]
    favourable = delta >= 0 if account in [0, "profit", "gross"] else delta <= 0
    return dict(id=f"{bu}:{account}", name=name or ACCOUNTS[account], **values,
                comparator=values[comparison], variance=delta,
                variancePercent=round(delta / abs(values[comparison]) * 100, 2) if values[comparison] else 0,
                favourable=favourable, sourceId=source_id(month, view, account, bu))


def drivers(month, view, bu, account):
    with connect() as db:
        rows = db.execute("""SELECT * FROM drivers WHERE (bu_id=? OR bu_id=-1) AND account_id=?
          AND first_month<=? AND last_month>=?""", (bu, account, month, 1 if view == "ytd" else month)).fetchall()
    if rows:
        return rows[0]["classification"], " ".join(r["explanation"] for r in rows)
    return "Unconfirmed", "The ledger shows a variance, but no operational driver has been recorded; confirm the cause with the budget owner."


def metric_values(month, view, scenario):
    revenue = totals(month, view, 0)[scenario]
    cogs = totals(month, view, 1)[scenario]
    opex = totals(month, view, "opex")[scenario]
    with connect() as db:
        stock = db.execute("SELECT headcount,customers FROM kpis WHERE month=? AND scenario=?", (month, scenario)).fetchone()
        avg = db.execute("SELECT avg(headcount) FROM kpis WHERE month BETWEEN ? AND ? AND scenario=?",
                         (1 if view == "ytd" else month, month, scenario)).fetchone()[0]
    if not stock:
        return [0] * 5
    return [round((revenue - cogs) / revenue * 100, 2), round(opex / revenue * 100, 2),
            stock["headcount"], round(revenue / avg, 2), stock["customers"]]


def kpis(month):
    current, ytd, budget, prior = [metric_values(month, view, scenario) for view, scenario in
                                 [("month", "actual"), ("ytd", "actual"), ("month", "budget"), ("month", "prior")]]
    previous = metric_values(month - 1, "month", "actual") if month > 1 else metric_values(12, "month", "prior")
    names = ["Gross Margin %", "OpEx as % of Revenue", "Headcount", "Revenue per FTE", "Customer count"]
    units = ["%", "%", "number", "$", "number"]
    result = []
    for i, name in enumerate(names):
        suffix = "%" if i < 2 else ""
        explanation = f"{name} is {current[i]:,.2f}{suffix}, compared with budget of {budget[i]:,.2f}{suffix}."
        if i in [2, 4]:
            explanation += " YTD is the period-end balance, not a sum."
        elif i == 3:
            explanation += " YTD uses cumulative revenue divided by average monthly headcount."
        result.append(dict(name=name, unit=units[i], current=current[i], ytd=ytd[i], budget=budget[i], prior=prior[i],
                           trend="up" if current[i] > previous[i] else "down" if current[i] < previous[i] else "flat",
                           explanation=explanation, sourceId=source_id(month, "ytd", "all", -1, "kpi")))
    return result


def report(month=9, view="month", comparison="budget"):
    conf = settings()
    available = month <= 9
    pnl = [financial_row(month, view, comparison, a) for a in range(10)] if available else []
    if available:
        pnl.insert(2, financial_row(month, view, comparison, "gross", name="Gross Profit"))
        pnl.append(financial_row(month, view, comparison, "opex", name="Operating Expenses"))
        pnl.append(financial_row(month, view, comparison, "profit", name="Operating Profit"))
    units = [financial_row(month, view, comparison, "opex", b, name=BUS[b]) for b in range(4)] if available else []
    variances = []
    if available:
        for b in range(4):
            for a in range(10):
                row = financial_row(month, view, comparison, a, b)
                if abs(row["variance"]) > conf["amountThreshold"] and abs(row["variancePercent"]) > conf["percentThreshold"]:
                    classification, driver = drivers(month, view, b, a)
                    variances.append(dict(**row, businessUnit=BUS[b], account=ACCOUNTS[a], classification=classification, driver=driver))
    variances.sort(key=lambda r: abs(r["variance"]), reverse=True)
    trends = []
    for m in range(1, 13):
        rev, op = totals(m, "month", 0), totals(m, "month", "opex")
        trends.append(dict(month=calendar.month_abbr[m], revenue=rev["actual"] if m <= 9 else None,
                           revenueBudget=rev["budget"], revenuePrior=rev["prior"], opex=op["actual"] if m <= 9 else None,
                           opexBudget=op["budget"], opexPrior=op["prior"]))
    with connect() as db:
        comments = db.execute("SELECT * FROM commentary WHERE month=? AND view=? AND comparison=? AND audience=? ORDER BY id",
                              (month, view, comparison, conf["audience"])).fetchall()
    return dict(month=month, periodLabel=f"{month_name(month)} 2026", view=view, comparison=comparison,
                available=available, dataNote="Illustrative sample data · actuals through September 2026" if available else
                "Actuals have not been loaded for this period. Budget, forecast and prior-year trend data remain available; commentary and export are unavailable.",
                pnl=pnl, businessUnits=units, variances=variances, kpis=kpis(month) if available else [],
                trends=trends, commentary=[commentary_dict(c) for c in comments], settings=conf,
                engine="Template mode")


def commentary_dict(row):
    return dict(id=row["id"], section=row["section"], title=row["title"], status=row["status"],
                audience=row["audience"], sentences=json.loads(row["sentences"]), engine=row["engine"], updatedAt=row["updated_at"])


def source_detail(sid):
    month, view, account, bu, kind = source_context(sid)
    ids = account_ids(account)
    with connect() as db:
        records = [dict(r) for r in db.execute(f"""SELECT printf('%04d-%02d',l.year,l.month) period,
          l.scenario, b.name businessUnit, c.name costCentre, a.name account,l.amount
          FROM ledger l JOIN cost_centres c ON l.cc_id=c.id
          JOIN business_units b ON b.id=c.bu_id JOIN accounts a ON a.id=l.account_id
          WHERE l.month BETWEEN ? AND ? AND l.account_id IN ({','.join('?' for _ in ids)})
          AND (?=-1 OR b.id=?) ORDER BY l.scenario,l.month,b.id,a.id,c.id""",
          [1 if view == "ytd" else month, month, *ids, bu, bu])]
        if kind == "kpi":
            for row in db.execute("SELECT * FROM kpis WHERE month<=? ORDER BY scenario,month", (month,)):
                for name, column in [("Headcount", "headcount"), ("Customer count", "customers")]:
                    records.append(dict(period=f'{row["year"]}-{row["month"]:02d}', scenario=row["scenario"],
                                        businessUnit="Group", costCentre="Group", account=name, amount=row[column]))
    description = "Source ledger in USD; expenses are positive. Gross profit = revenue − COGS; operating profit = revenue − COGS − OpEx."
    if kind == "kpi":
        description += " Ratios use aggregated revenue/costs; YTD stocks are closing balances; revenue/FTE uses average headcount. Trend compares previous month."
    if isinstance(account, int):
        description += " " + drivers(month, view, bu, account)[1]
    return dict(id=sid, description=description, records=records)
