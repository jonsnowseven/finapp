"""
Extractor for Banco Invest – Alves Ribeiro PPR PDF statements.

Banco Invest PDFs contain a movimentos table:
  Data | Designação | Nº Unidades | Preço (€) | Montante (€) | Comissão (€)

Typical rows:
  15/03/2024  Subscrição  100,0000  10,5000  1.050,00  0,00
  15/06/2024  Mais-Valias  0,0000  0,0000  52,50  0,00
"""

import re
from pathlib import Path
from typing import Any

import pdfplumber

from utils.formatters import parse_pt_date, parse_pt_number

ENTITY = 'Banco Invest'

_TYPE_MAP = {
    'subscri': 'deposit',
    'reembolso': 'sell',
    'resgate': 'sell',
    'mais-valia': 'interest',
    'mais valia': 'interest',
    'rendimento': 'interest',
    'dividend': 'dividend',
    'transfer': 'deposit',
}


def _classify_type(description: str) -> str:
    lower = description.lower()
    for keyword, tx_type in _TYPE_MAP.items():
        if keyword in lower:
            return tx_type
    return 'deposit'


def _extract_fund_name(text: str) -> str:
    match = re.search(r'(Alves Ribeiro[^\n\r]{0,60}|PPR[^\n\r]{0,60})', text, re.IGNORECASE)
    return match.group(1).strip() if match else 'Alves Ribeiro PPR'


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
                    if not raw_date or not description:
                        continue
                    try:
                        date = parse_pt_date(str(raw_date).strip())
                    except ValueError:
                        continue

                    # Amount column (index 4) and optional fees column (index 5)
                    raw_amount = rest[0] if len(rest) > 0 else None
                    raw_fees = rest[1] if len(rest) > 1 else None

                    qty = parse_pt_number(str(raw_qty))
                    price = parse_pt_number(str(raw_price))
                    amount = parse_pt_number(str(raw_amount)) if raw_amount else qty * price
                    fees = parse_pt_number(str(raw_fees)) if raw_fees else 0.0

                    if amount == 0:
                        continue

                    tx_type = _classify_type(str(description))
                    source = f"bancoinvest_{pdf_path.stem}_{date}_{tx_type}"

                    records.append({
                        'date': date,
                        'entity': ENTITY,
                        'asset_name': fund_name,
                        'transaction_type': tx_type,
                        'quantity': qty if qty != 0 else None,
                        'price': price if price != 0 else None,
                        'amount': abs(amount),
                        'currency': 'EUR',
                        'fees': abs(fees),
                        'source_document': source,
                    })

    return records
