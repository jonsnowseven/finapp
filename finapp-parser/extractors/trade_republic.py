"""
Extractor for Trade Republic native CSV export.

Trade Republic CSV columns:
  date, time, status, type, sharesAmount, instrumentTitle, instrumentSubtitle,
  isin, amount, currency, fees, note

Example rows:
  2024-01-15,09:30:00,EXECUTED,buy,10,Vanguard FTSE All-World UCITS ETF,VWCE,IE00B3RBWM25,950.00,EUR,0.00,
  2024-02-01,10:00:00,EXECUTED,dividend,0,Vanguard FTSE All-World UCITS ETF,VWCE,IE00B3RBWM25,4.20,EUR,0.00,
"""

import csv
from pathlib import Path
from typing import Any

from utils.formatters import parse_pt_date, parse_pt_number

ENTITY = 'Trade Republic'

_TYPE_MAP = {
    'buy': 'buy',
    'sell': 'sell',
    'dividend': 'dividend',
    'deposit': 'deposit',
    'withdrawal': 'sell',
    'interest': 'interest',
    'savingsplan': 'buy',
    'savings_plan': 'buy',
}


def _classify_type(raw_type: str) -> str:
    return _TYPE_MAP.get(raw_type.lower().replace(' ', '_'), 'buy')


def extract(csv_path: str | Path) -> list[dict[str, Any]]:
    csv_path = Path(csv_path)
    records: list[dict[str, Any]] = []

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        for i, row in enumerate(reader):
            status = row.get('status', '').strip().upper()
            if status and status != 'EXECUTED':
                continue

            raw_date = row.get('date', '').strip()
            if not raw_date:
                continue
            try:
                date = parse_pt_date(raw_date)
            except ValueError:
                continue

            raw_type = row.get('type', 'buy').strip()
            tx_type = _classify_type(raw_type)

            shares_raw = row.get('sharesAmount', '').strip()
            amount_raw = row.get('amount', '').strip()
            fees_raw = row.get('fees', '0').strip()

            asset_name = row.get('instrumentTitle', '').strip() or 'Unknown'
            subtitle = row.get('instrumentSubtitle', '').strip()
            if subtitle:
                asset_name = f"{asset_name} ({subtitle})"

            currency = row.get('currency', 'EUR').strip() or 'EUR'

            qty = parse_pt_number(shares_raw) if shares_raw else None
            amount = parse_pt_number(amount_raw)
            fees = parse_pt_number(fees_raw)

            if amount == 0:
                continue

            price = (amount / qty) if qty and qty != 0 else None
            source = f"traderepublic_{csv_path.stem}_{date}_{i}"

            records.append({
                'date': date,
                'entity': ENTITY,
                'asset_name': asset_name,
                'transaction_type': tx_type,
                'quantity': qty if qty else None,
                'price': round(price, 6) if price else None,
                'amount': abs(amount),
                'currency': currency,
                'fees': abs(fees),
                'source_document': source,
            })

    return records
