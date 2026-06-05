import re
from datetime import datetime


def parse_pt_number(value: str) -> float:
    """Convert Portuguese-formatted number string to float.

    Portuguese format uses period as thousands separator and comma as decimal:
    '1.000,50' -> 1000.50
    '1.234.567,89' -> 1234567.89
    '1000,50' -> 1000.50
    '100' -> 100.0
    """
    if not value:
        return 0.0

    # Strip currency symbols and whitespace
    cleaned = re.sub(r'[€$£\s]', '', str(value)).strip()

    # Remove leading minus sign temporarily
    negative = cleaned.startswith('-')
    if negative:
        cleaned = cleaned[1:]

    # If both . and , are present, determine which is decimal separator
    if ',' in cleaned and '.' in cleaned:
        last_comma = cleaned.rfind(',')
        last_dot = cleaned.rfind('.')
        if last_comma > last_dot:
            # Portuguese format: 1.000,50
            cleaned = cleaned.replace('.', '').replace(',', '.')
        else:
            # Already standard: 1,000.50
            cleaned = cleaned.replace(',', '')
    elif ',' in cleaned:
        # Could be decimal comma (Portuguese) or thousands comma (English)
        parts = cleaned.split(',')
        if len(parts) == 2 and len(parts[1]) <= 2:
            # Likely decimal: 1000,50 -> 1000.50
            cleaned = cleaned.replace(',', '.')
        else:
            # Thousands comma: 1,000 -> 1000
            cleaned = cleaned.replace(',', '')

    try:
        result = float(cleaned)
        return -result if negative else result
    except ValueError:
        return 0.0


def parse_pt_date(value: str) -> str:
    """Parse Portuguese date formats and return ISO 8601 (YYYY-MM-DD) string.

    Handles formats: 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD'.
    """
    value = value.strip()
    for fmt in ('%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y', '%Y-%m-%d', '%d/%m/%y'):
        try:
            return datetime.strptime(value, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date format: '{value}'")


def normalise_currency(value: str) -> str:
    """Map common currency symbols to ISO 4217 codes."""
    mapping = {'€': 'EUR', '$': 'USD', '£': 'GBP', 'USD': 'USD', 'EUR': 'EUR'}
    return mapping.get(value.strip(), value.strip().upper())
