"""
Extractor for DeGiro native CSV export.

DeGiro CSV columns (English export):
  Date, Time, Value date, Product, ISIN, Description, FX, Change, , Balance, , Order ID

DeGiro CSV columns (Portuguese export):
  Data, Hora, Data valor, Produto, ISIN, Descrição, FX, Mutação, , Saldo, , ID ordem
"""

import csv
from pathlib import Path
from typing import Any

from utils.formatters import parse_pt_date, parse_pt_number

ENTITY = 'DeGiro'

_TYPE_MAP = {
    'compra': 'buy',
    'buy': 'buy',
    'venda': 'sell',
    'sell': 'sell',
    'dividend': 'dividend',
    'dividendo': 'dividend',
    'depósito': 'deposit',
    'deposit': 'deposit',
    'levantamento': 'sell',
    'withdrawal': 'sell',
    'juro': 'interest',
    'interest': 'interest',
    'taxa': 'fees',
    'fee': 'fees',
}


def _classify_type(description: str) -> str:
    lower = description.lower()
    for keyword, tx_type in _TYPE_MAP.items():
        if keyword in lower:
            return tx_type
    return 'buy'


def extract(csv_path: str | Path) -> list[dict[str, Any]]:
    csv_path = Path(csv_path)
    records: list[dict[str, Any]] = []

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        headers = [h.lower().strip() for h in (reader.fieldnames or [])]

        date_col = next((h for h in headers if 'data' in h or 'date' in h), None)
        product_col = next((h for h in headers if 'produto' in h or 'product' in h), None)
        desc_col = next((h for h in headers if 'descri' in h or 'description' in h), None)
        amount_col = next((h for h in headers if 'muta' in h or 'change' in h), None)
        currency_col = next((h for h in headers if h == 'fx'), None)

        for i, row in enumerate(reader):
            # Re-key by lowercase
            row = {k.lower().strip(): v for k, v in row.items()}

            raw_date = row.get(date_col or '', '').strip()
            if not raw_date:
                continue
            try:
                date = parse_pt_date(raw_date)
            except ValueError:
                continue

            product = row.get(product_col or '', '').strip() or 'Unknown'
            description = row.get(desc_col or '', '').strip()
            raw_amount = row.get(amount_col or '', '').strip()
            currency = row.get(currency_col or '', 'EUR').strip() or 'EUR'

            amount = parse_pt_number(raw_amount)
            if amount == 0:
                continue

            tx_type = _classify_type(description)
            source = f"degiro_{csv_path.stem}_{date}_{i}"

            records.append({
                'date': date,
                'entity': ENTITY,
                'asset_name': product,
                'transaction_type': tx_type,
                'quantity': None,
                'price': None,
                'amount': abs(amount),
                'currency': currency,
                'fees': 0.0,
                'source_document': source,
            })

    return records
