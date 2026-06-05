"""
Extractor for Kraken trade history PDF exports.

Kraken PDF columns:
  Unique ID | Time (UTC) | Pair | Type | Subtype | Price | Cost | Volume | Fee | Margin

Example rows:
  TLNGJK-4SW6N-HP4OFF  2021-02-25 12:18:31  BTC/EUR  Buy  Limit  41000.0000  998.4026  0.0244  1.5974  0.0000
  T4VZ4S-ATOPY-2UHAX2  2021-04-19 16:05:26  BTC/USD  Sell  Limit  55212.5000  336.1238  0.0061  0.5378  0.0000
"""

import re
from pathlib import Path
from typing import Any

import pdfplumber

ENTITY = 'Kraken'

_ASSET_MAP = {
    'BTC': 'Bitcoin',
    'XBT': 'Bitcoin',
    'ETH': 'Ethereum',
    'SOL': 'Solana',
    'ADA': 'Cardano',
    'DOT': 'Polkadot',
    'MATIC': 'Polygon',
    'LINK': 'Chainlink',
    'AVAX': 'Avalanche',
    'XRP': 'Ripple',
    'LTC': 'Litecoin',
    'ATOM': 'Cosmos',
    'UNI': 'Uniswap',
    'ALGO': 'Algorand',
}

_QUOTE_CURRENCIES = {'EUR', 'USD', 'GBP', 'USDT', 'USDC'}


def _parse_pair(pair: str) -> tuple[str, str]:
    """Split 'BTC/EUR' into ('Bitcoin', 'EUR'). Falls back to raw base if unknown."""
    pair = pair.strip().upper()
    if '/' in pair:
        base, quote = pair.split('/', 1)
    else:
        # Try to split known quote currencies from the end
        quote = next((q for q in _QUOTE_CURRENCIES if pair.endswith(q)), 'EUR')
        base = pair[: len(pair) - len(quote)]

    asset_name = _ASSET_MAP.get(base, base)
    currency = quote if quote in _QUOTE_CURRENCIES else 'EUR'
    return asset_name, currency


def _parse_date(raw: str) -> str:
    """'2021-02-25 12:18:31' → '2021-02-25'"""
    return raw.strip()[:10]


def _map_type(raw: str) -> str:
    return {'buy': 'buy', 'sell': 'sell'}.get(raw.strip().lower(), 'buy')


def _parse_number(raw: str) -> float:
    try:
        return float(raw.strip().replace(',', ''))
    except ValueError:
        return 0.0


def extract(pdf_path: str | Path) -> list[dict[str, Any]]:
    pdf_path = Path(pdf_path)
    records: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if not row or len(row) < 9:
                        continue

                    tx_id, raw_time, pair, raw_type, _subtype, raw_price, raw_cost, raw_volume, raw_fee, *_ = row

                    # Skip header rows
                    if not tx_id or tx_id.strip().lower() in ('unique id', 'id', ''):
                        continue
                    if not raw_time or not pair:
                        continue

                    try:
                        date = _parse_date(raw_time)
                    except Exception:
                        continue

                    asset_name, currency = _parse_pair(pair)
                    tx_type = _map_type(raw_type)
                    cost = _parse_number(raw_cost)
                    volume = _parse_number(raw_volume)
                    price = _parse_number(raw_price)
                    fee = _parse_number(raw_fee)

                    if cost == 0 and volume == 0:
                        continue

                    source = f"kraken_{tx_id.strip()}"

                    records.append({
                        'date': date,
                        'entity': ENTITY,
                        'asset_name': asset_name,
                        'transaction_type': tx_type,
                        'quantity': volume if volume != 0 else None,
                        'price': price if price != 0 else None,
                        'amount': cost,
                        'currency': currency,
                        'fees': fee,
                        'source_document': source,
                    })

    return records
