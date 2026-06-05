"""
Extractor for Fidelidade MySavings PDF statements.

Fidelidade PDFs contain a movimentos table with columns:
  Data | Descrição | Valor (€)

Typical rows:
  01/02/2024  Prémio Inicial  2.500,00
  01/05/2024  Rendimento Anual  62,50
"""

import re
from pathlib import Path
from typing import Any

import pdfplumber

from utils.formatters import parse_pt_date, parse_pt_number

ENTITY = 'Fidelidade'

_TYPE_MAP = {
    'prémio': 'deposit',
    'premio': 'deposit',
    'reembolso': 'sell',
    'rendimento': 'interest',
    'participa': 'interest',
    'bonus': 'interest',
    'bónus': 'interest',
}


def _classify_type(description: str) -> str:
    lower = description.lower()
    for keyword, tx_type in _TYPE_MAP.items():
        if keyword in lower:
            return tx_type
    return 'deposit'


def _extract_product_name(text: str) -> str:
    match = re.search(r'(MySavings[^\n\r]{0,60}|Poupança[^\n\r]{0,60})', text, re.IGNORECASE)
    return match.group(1).strip() if match else 'Fidelidade MySavings'


def extract(pdf_path: str | Path) -> list[dict[str, Any]]:
    pdf_path = Path(pdf_path)
    records: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as pdf:
        full_text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        product_name = _extract_product_name(full_text)

        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if not row or len(row) < 3:
                        continue
                    raw_date, description, raw_amount, *_ = row
                    if not raw_date or not description:
                        continue
                    try:
                        date = parse_pt_date(str(raw_date).strip())
                    except ValueError:
                        continue

                    amount = parse_pt_number(str(raw_amount).strip())
                    if amount == 0:
                        continue

                    tx_type = _classify_type(str(description))
                    source = f"fidelidade_{pdf_path.stem}_{date}_{tx_type}"

                    records.append({
                        'date': date,
                        'entity': ENTITY,
                        'asset_name': product_name,
                        'transaction_type': tx_type,
                        'quantity': None,
                        'price': None,
                        'amount': abs(amount),
                        'currency': 'EUR',
                        'fees': 0.0,
                        'source_document': source,
                    })

    return records
