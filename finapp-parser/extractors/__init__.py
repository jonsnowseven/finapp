from .aforro import extract as extract_aforro
from .banco_invest import extract as extract_banco_invest
from .degiro import extract as extract_degiro
from .fidelidade import extract as extract_fidelidade
from .kraken_pdf import extract as extract_kraken_pdf
from .sgf_ppr import extract as extract_sgf_ppr
from .trade_republic import extract as extract_trade_republic

__all__ = [
    'extract_aforro',
    'extract_banco_invest',
    'extract_degiro',
    'extract_fidelidade',
    'extract_kraken_pdf',
    'extract_sgf_ppr',
    'extract_trade_republic',
]
