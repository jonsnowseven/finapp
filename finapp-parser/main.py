# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "supabase",
#     "python-dotenv",
#     "pdfplumber",
#     "pandas",
# ]
# ///
"""
FinApp Local Data Loader
------------------------
Usage:
  uv run main.py --type aforro    --file statements/aforro_2024.pdf
  uv run main.py --type sgf       --file statements/sgf_ppr_2024.pdf
  uv run main.py --type fidelidade --file statements/fidelidade_2024.pdf
  uv run main.py --type bancoinvest --file statements/bancoinvest_2024.pdf
  uv run main.py --type degiro    --file statements/transactions.csv
  uv run main.py --type traderepublic --file statements/trade_republic.csv

  # Process a whole directory (uses file extension + name heuristics):
  uv run main.py --dir statements/

  # Dry run (parse but don't push to Supabase):
  uv run main.py --type degiro --file transactions.csv --dry-run
"""

import argparse
import sys
from pathlib import Path

from database import upsert_transactions
from extractors import (
    extract_aforro,
    extract_banco_invest,
    extract_degiro,
    extract_fidelidade,
    extract_kraken_pdf,
    extract_sgf_ppr,
    extract_trade_republic,
)

EXTRACTOR_MAP = {
    'aforro': extract_aforro,
    'sgf': extract_sgf_ppr,
    'fidelidade': extract_fidelidade,
    'bancoinvest': extract_banco_invest,
    'degiro': extract_degiro,
    'kraken': extract_kraken_pdf,
    'traderepublic': extract_trade_republic,
}

NAME_HINTS = {
    'aforro': 'aforro',
    'sgf': 'sgf',
    'sgfppr': 'sgf',
    'fidelidade': 'fidelidade',
    'mysavings': 'fidelidade',
    'bancoinvest': 'bancoinvest',
    'alvesribeiro': 'bancoinvest',
    'degiro': 'degiro',
    'kraken': 'kraken',
    'traderepublic': 'traderepublic',
    'trade_republic': 'traderepublic',
}


def detect_type(path: Path) -> str | None:
    stem_lower = path.stem.lower().replace('-', '').replace(' ', '')
    for hint, extractor_key in NAME_HINTS.items():
        if hint in stem_lower:
            return extractor_key
    return None


def run_single(file: Path, extractor_key: str, dry_run: bool) -> None:
    extractor = EXTRACTOR_MAP.get(extractor_key)
    if not extractor:
        print(f'  ✗ Unknown extractor type: {extractor_key}')
        return

    print(f'  Parsing {file.name} with extractor "{extractor_key}"...')
    try:
        records = extractor(file)
    except Exception as e:
        print(f'  ✗ Parse error: {e}')
        return

    print(f'  Found {len(records)} record(s).')
    if not records:
        return

    if dry_run:
        for r in records:
            print(f'    {r}')
        return

    inserted = upsert_transactions(records)
    print(f'  ✓ Pushed {inserted} record(s) to Supabase.')


def run_directory(directory: Path, dry_run: bool) -> None:
    files = sorted(directory.iterdir())
    for file in files:
        if file.suffix.lower() not in ('.pdf', '.csv'):
            continue
        extractor_key = detect_type(file)
        if not extractor_key:
            print(f'  ? Skipping {file.name} — could not detect type from filename.')
            continue
        run_single(file, extractor_key, dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(description='FinApp local PDF/CSV loader')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--file', type=Path, help='Path to a single PDF or CSV file')
    group.add_argument('--dir', type=Path, help='Directory of PDFs/CSVs to process in bulk')
    parser.add_argument('--type', choices=list(EXTRACTOR_MAP.keys()), help='Extractor type (required with --file)')
    parser.add_argument('--dry-run', action='store_true', help='Parse only, do not push to Supabase')
    args = parser.parse_args()

    if args.file:
        if not args.type:
            print('Error: --type is required when using --file.')
            sys.exit(1)
        if not args.file.exists():
            print(f'Error: file not found: {args.file}')
            sys.exit(1)
        run_single(args.file, args.type, args.dry_run)

    elif args.dir:
        if not args.dir.is_dir():
            print(f'Error: not a directory: {args.dir}')
            sys.exit(1)
        run_directory(args.dir, args.dry_run)


if __name__ == '__main__':
    main()
