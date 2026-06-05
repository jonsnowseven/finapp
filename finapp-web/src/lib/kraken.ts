import crypto from 'crypto';

export interface KrakenTransaction {
  date: string;
  entity: string;
  asset_name: string;
  transaction_type: string;
  quantity: number | null;
  price: number | null;
  amount: number;
  currency: string;
  fees: number;
  source_document: string;
}

const KRAKEN_API_URL = 'https://api.kraken.com';

function buildKrakenSignature(path: string, nonce: string, postData: string, secret: string): string {
  const message = path + crypto.createHash('sha256').update(nonce + postData).digest('binary');
  const secretBuf = Buffer.from(secret, 'base64');
  return crypto.createHmac('sha512', secretBuf).update(message, 'binary').digest('base64');
}

async function krakenPrivateRequest(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const apiKey = process.env.KRAKEN_API_KEY;
  const apiSecret = process.env.KRAKEN_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('KRAKEN_API_KEY and KRAKEN_API_SECRET must be set');
  }

  const nonce = Date.now().toString();
  const path = `/0/private/${endpoint}`;
  const postData = new URLSearchParams({ nonce, ...params }).toString();
  const signature = buildKrakenSignature(path, nonce, postData, apiSecret);

  const response = await fetch(`${KRAKEN_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });

  const json = await response.json();
  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken API error: ${json.error.join(', ')}`);
  }
  return json.result;
}

function mapKrakenAssetName(krakenAsset: string): string {
  const mapping: Record<string, string> = {
    XXBT: 'Bitcoin',
    XETH: 'Ethereum',
    XBT: 'Bitcoin',
    ETH: 'Ethereum',
    SOL: 'Solana',
    ADA: 'Cardano',
    DOT: 'Polkadot',
    MATIC: 'Polygon',
    LINK: 'Chainlink',
    AVAX: 'Avalanche',
  };
  return mapping[krakenAsset] || krakenAsset;
}

function mapKrakenType(type: string): string {
  const mapping: Record<string, string> = {
    buy: 'buy',
    sell: 'sell',
    deposit: 'deposit',
    withdrawal: 'sell',
    staking: 'interest',
    dividend: 'dividend',
  };
  return mapping[type] || type;
}

export async function fetchKrakenTransactions(): Promise<KrakenTransaction[]> {
  const ledgers: any = await krakenPrivateRequest('Ledgers', { type: 'all' });
  const entries = Object.values(ledgers.ledger || {}) as any[];

  return entries.map((entry) => {
    const asset = mapKrakenAssetName(entry.asset);
    const type = mapKrakenType(entry.type);
    const amount = Math.abs(Number(entry.amount));
    const fee = Math.abs(Number(entry.fee));
    const date = new Date(entry.time * 1000).toISOString().split('T')[0];

    return {
      date,
      entity: 'Kraken',
      asset_name: asset,
      transaction_type: type,
      quantity: null,
      price: null,
      amount,
      currency: 'EUR',
      fees: fee,
      source_document: `kraken_ledger_${entry.refid}`,
    };
  });
}
