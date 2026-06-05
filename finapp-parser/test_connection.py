# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "supabase",
#     "python-dotenv",
# ]
# ///

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from the .env file in the same directory
load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

# Check if environment variables are loaded properly
if not url or not key:
    print("❌ Error: SUPABASE_URL or SUPABASE_KEY missing from .env file.")
    exit(1)

# Initialize the Supabase client
supabase: Client = create_client(url, key)

def push_dummy_transaction():
    print("Preparing dummy transaction using uv...")
    
    # This dictionary exactly matches our SQL table structure
    dummy_data = {
        "date": "2026-06-01",
        "entity": "AforroNet",
        "asset_name": "Certificados de Aforro Série F",
        "transaction_type": "deposit",
        "quantity": 100,
        "price": 1.0,
        "amount": 100.00,
        "currency": "EUR",
        "fees": 0.0,
        "source_document": "uv_manual_test_run"
    }

    try:
        # Insert the data into the 'transactions' table
        response = supabase.table("transactions").insert(dummy_data).execute()
        
        # Supabase returns the inserted data upon success
        if response.data:
            print("✅ Success! Transaction pushed to Supabase.")
            print(f"Inserted ID: {response.data[0]['id']}")
        else:
            print("⚠️ Request succeeded, but no data was returned.")
            
    except Exception as e:
        print("❌ Error pushing to Supabase:", e)

if __name__ == "__main__":
    push_dummy_transaction()
