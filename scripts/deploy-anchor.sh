#!/usr/bin/env bash
# Builds the Anchor program and deploys to Solana devnet.
# Prints the program ID. Update src/lib/constants.ts and .env if it differs from the default.
set -euo pipefail
cd "$(dirname "$0")/../anchor"
anchor build
PROGRAM_ID=$(solana-keygen pubkey target/deploy/marketplace_escrow-keypair.json)
echo "Program ID: $PROGRAM_ID"
solana program deploy target/deploy/marketplace_escrow.so \
  --program-id target/deploy/marketplace_escrow-keypair.json \
  --url devnet --use-rpc --with-compute-unit-price 1000 --max-sign-attempts 200
cp target/idl/marketplace_escrow.json ../src/lib/solana/idl.json
echo "IDL copied to src/lib/solana/idl.json"
echo "Done. If the program ID changed, update declare_id! in lib.rs, Anchor.toml, .env, src/lib/constants.ts and rebuild."
