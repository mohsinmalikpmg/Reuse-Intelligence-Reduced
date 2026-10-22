from collections import defaultdict
from .data import rows


def totals(data):
    revenue = sum(r["q3"] for r in data if r["account"] == "Revenue")
    cogs = sum(r["q3"] for r in data if r["account"] == "COGS")
    opex = sum(r["q3"] for r in data if r["account"] not in ("Revenue", "COGS"))
    return round(revenue, 2), round(opex, 2), round(revenue - cogs - opex, 2)


def project(inputs):
    data = rows()
    baseline = totals(data)
    grouped = defaultdict(list)
    for r in data:
        grouped[(r["costCentre"], r["account"])].append(r)
    selected = [r for r in data if r["month"] > 9 and r["account"] == inputs.account]
    for group in grouped.values():
        history = [r["actual"] for r in group if r["month"] <= 9 and (inputs.method != "last3" or r["month"] >= 7)]
        average = sum(history) / len(history)
        for r in group:
            if r["month"] <= 9:
                continue
            value = r["q3"] if inputs.method == "forecast" else average
            if r["account"] == "Revenue":
                value *= 1 + inputs.revenueGrowth / 100
            if r["account"] == "Salaries & Benefits":
                value *= 1 + inputs.headcountCost / 100
            if r["account"] == inputs.account and selected:
                value += inputs.accountAdjustment / len(selected)
            r["q3"] = round(value, 2)
    revenue, opex, profit = totals(data)
    return dict(rows=data, revenue=revenue, opex=opex, profit=profit,
                baselineRevenue=baseline[0], baselineOpex=baseline[1], baselineProfit=baseline[2],
                calculation="Jan–Sep actuals + Oct–Dec projection. Remaining months use " +
                {"forecast": "Q3 forecast", "ytd": "Jan–Sep actual monthly average", "last3": "Jul–Sep actual monthly average"}[inputs.method] +
                ". Percentage changes apply only to remaining revenue/salaries; account dollars are a total adjustment spread equally over remaining account rows. OpEx excludes COGS and Revenue. Profit = Revenue − COGS − OpEx.")


def aggregate(data, group="businessUnit", value="q3", budget="budget"):
    result = {}
    for r in data:
        key = r[group]
        item = result.setdefault(key, dict(label=key, budget=0, value=0, variance=0, driver=r["driver"]))
        item["budget"] += r[budget] or 0
        item["value"] += r[value] or 0
    for item in result.values():
        item["budget"] = round(item["budget"], 2)
        item["value"] = round(item["value"], 2)
        item["variance"] = round(item["value"] - item["budget"], 2)
    return list(result.values())
