"""
Extractor for AforroNet – Certificados de Aforro PDF statements.

AforroNet PDFs contain a transaction table with columns:
  Data | Descrição | Valor (€) | Saldo (€)

Typical rows look like:
  01/01/2024  Subscrição  1.000,00  1.000,00
  01/04/2024  Juro Trimestral  12,50  1.012,50
  01/07/2024  Juro Trimestral  12,65  1.025,15
"""

import re
from pathlib import Path
from typing import Any

import pdfplumber

from utils.formatters import parse_pt_date, parse_pt_number

ASSET_NAME = 'Certificados de Aforro'
ENTITY = 'AforroNet'

_TYPE_MAP = {
    'subscri': 'deposit',
    'reembolso': 'sell',
    'juro': 'interest',
    'capitaliza': 'interest',
    'bonifica': 'interest',
}


def _classify_type(description: str) -> str:
    lower = description.lower()
    for keyword, tx_type in _TYPE_MAP.items():
        if keyword in lower:
            return tx_type
    return 'deposit'


def _extract_serie(text: str) -> str:
    match = re.search(r'[Ss]érie\s+([A-Z])', text)
    return f"Certificados de Aforro Série {match.group(1)}" if match else ASSET_NAME


def extract(pdf_path: str | Path) -> list[dict[str, Any]]:
    pdf_path = Path(pdf_path)
    records: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as pdf:
        full_text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        asset_name = _extract_serie(full_text)

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
                    source = f"aforro_{pdf_path.stem}_{date}_{tx_type}"

                    records.append({
                        'date': date,
                        'entity': ENTITY,
                        'asset_name': asset_name,
                        'transaction_type': tx_type,
                        'quantity': None,
                        'price': None,
                        'amount': abs(amount),
                        'currency': 'EUR',
                        'fees': 0.0,
                        'source_document': source,
                    })

    return records
