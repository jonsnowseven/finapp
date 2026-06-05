export interface RevolutTransaction {
  date: string;
  entity: string;
  asset_name: string;
  transaction_type: string;
  quantity: null;
  price: null;
  amount: number;
  currency: string;
  fees: number;
  source_document: string;
}

const NORDIGEN_BASE_URL = 'https://bankaccountdata.gocardless.com/api/v2';

async function getNordigenToken(): Promise<string> {
  const secretId = process.env.NORDIGEN_SECRET_ID;
  const secretKey = process.env.NORDIGEN_SECRET_KEY;

  if (!secretId || !secretKey) {
    throw new Error('NORDIGEN_SECRET_ID and NORDIGEN_SECRET_KEY must be set');
  }

  const response = await fetch(`${NORDIGEN_BASE_URL}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  });

  const data = await response.json();
  if (!data.access) throw new Error('Failed to get Nordigen access token');
  return data.access;
}

async function nordigenGet(path: string, token: string): Promise<any> {
  const response = await fetch(`${NORDIGEN_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return response.json();
}

function mapNordigenType(bookingStatus: string, amount: number): string {
  if (amount > 0) return 'deposit';
  return 'sell';
}

export async function fetchRevolutTransactions(): Promise<RevolutTransaction[]> {
  const accountId = process.env.REVOLUT_ACCOUNT_ID;
  if (!accountId) throw new Error('REVOLUT_ACCOUNT_ID must be set');

  const token = await getNordigenToken();
  const txData = await nordigenGet(`/accounts/${accountId}/transactions/`, token);

  const booked: any[] = txData.transactions?.booked ?? [];

  return booked.map((tx) => {
    const amount = Number(tx.transactionAmount?.amount ?? 0);
    const currency = tx.transactionAmount?.currency ?? 'EUR';
    const date = tx.bookingDate ?? tx.valueDate ?? new Date().toISOString().split('T')[0];
    const ref = tx.transactionId ?? tx.internalTransactionId ?? `revolut_${Date.now()}`;
    const description = tx.remittanceInformationUnstructured ?? tx.additionalInformation ?? 'Revolut Transaction';

    return {
      date,
      entity: 'Revolut',
      asset_name: description,
      transaction_type: mapNordigenType(tx.bookingStatus, amount),
      quantity: null,
      price: null,
      amount: Math.abs(amount),
      currency,
      fees: 0,
      source_document: `revolut_${ref}`,
    };
  });
}
