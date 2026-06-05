"""
Extractor for SGF PPR PDF statements.

SGF (Sociedade Gestora de Fundos) PPR PDFs contain a movements table:
  Data | Tipo de Operação | Nº Unidades | Valor UP (€) | Montante (€)

Typical rows:
  15/01/2024  Subscrição  100,0000  5,0000  500,00
  15/04/2024  Subscrição  50,0000  5,1200  256,00
"""

import re
from pathlib import Path
from typing import Any

import pdfplumber

from utils.formatters import parse_pt_date, parse_pt_number

ENTITY = 'SGF'

_TYPE_MAP = {
    'subscri': 'deposit',
    'reembolso': 'sell',
    'transfer': 'deposit',
    'rendimento': 'interest',
    'mais-valia': 'interest',
}


def _classify_type(description: str) -> str:
    lower = description.lower()
    for keyword, tx_type in _TYPE_MAP.items():
        if keyword in lower:
            return tx_type
    return 'deposit'


def _extract_fund_name(text: str) -> str:
    match = re.search(r'(PPR[^\n\r]{0,60})', text)
    return match.group(1).strip() if match else 'SGF PPR'


def extract(pdf_path: str | Path) -> list[dict[str, Any]]:
    pdf_path = Path(pdf_path)
    records: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as pdf:
        full_text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        fund_name = _extract_fund_name(full_text)

        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if not row or len(row) < 4:
                        continue
                    raw_date, description, raw_qty, raw_price, *rest = row
                    raw_amount = rest[0] if rest else None

                    if not raw_date or not description:
                        continue
                    try:
                        date = parse_pt_date(str(raw_date).strip())
                    except ValueError:
                        continue

                    # Use last column as amount if present, else qty * price
                    if raw_amount:
                        amount = parse_pt_number(str(raw_amount))
                    else:
                        qty = parse_pt_number(str(raw_qty))
                        price = parse_pt_number(str(raw_price))
                        amount = qty * price

                    if amount == 0:
                        continue

                    qty_val = parse_pt_number(str(raw_qty))
                    price_val = parse_pt_number(str(raw_price))
                    tx_type = _classify_type(str(description))
                    source = f"sgf_{pdf_path.stem}_{date}_{tx_type}"

                    records.append({
                        'date': date,
                        'entity': ENTITY,
                        'asset_name': fund_name,
                        'transaction_type': tx_type,
                        'quantity': qty_val if qty_val != 0 else None,
                        'price': price_val if price_val != 0 else None,
                        'amount': abs(amount),
                        'currency': 'EUR',
                        'fees': 0.0,
                        'source_document': source,
                    })

    return records
