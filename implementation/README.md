# CareChain — Implementation

A decentralized healthcare information exchange prototype implementing the three contributions
from [`/PLAN.md`](../PLAN.md): time-bound/purpose-bound (ABAC) consent, break-glass emergency access
with mandatory audit + notification, and Merkle-batched hash anchoring.

**Prerequisites:** Node.js 18+ and npm. (Tested on Node 24 / Windows 11.)

## Project layout

```
implementation/
  contracts/           Solidity contracts (Hardhat)
    CareChainRegistry.sol   identity + role registry (patient/provider/auditor/admin)
    AuditLog.sol             append-only shared audit trail
    ConsentManager.sol       ABAC time-bound/purpose-bound consent (contribution b)
    RecordAnchor.sol         individual + Merkle-batched anchoring (contribution d)
    EmergencyAccess.sol      break-glass access + audit + notification flag (contribution c)
    benchmark/NaiveConsent.sol   throwaway baseline used only by Experiment 5
  test/                Hardhat/Mocha unit tests, including negative cases
  scripts/deploy.js    minimal deploy script
  scripts/seed-demo.js one-command local bootstrap: deploys + registers a demo cast + writes
                       backend/src/chain/{deployment.json,users.json}
  backend/             Express REST API (role-based auth, encryption, chain interaction)
  frontend/            Minimal React UI (Vite)
```

## Quick start (local demo, three terminals)

```bash
# from implementation/
npm install
npm run compile
npm test
```

```bash
# terminal 1: local chain
npx hardhat node
```

```bash
# terminal 2: deploy + seed demo accounts (waits for the node above)
npm run seed:local
cp .env.example .env
npm run backend
```

```bash
# terminal 3: frontend
cd frontend
npm install
npm run dev
```

To check the whole stack without the UI, run the end-to-end test against the running backend
(logs in as each role, uploads/encrypts/anchors a record, exercises consent grant/deny/revoke,
purpose- and time-bound checks, Merkle-batched upload with on-chain proof verification,
break-glass access and the audit trail -- 41 assertions):

```bash
npm run e2e
```

Open the Vite dev server URL (default `http://localhost:5173`) and sign in as one of the demo
accounts printed by `seed:local` (`patient1`, `patient2`, `doctor1`, `erdoctor1`, `auditor1`, `admin`;
all use password `password123`).

## Merkle-batched upload

Choose **several files** in the provider's upload form (or `POST /records/upload-batch`, multipart field
`files`) to anchor them as one batch: one `anchorBatch` transaction stores only the Merkle root, a
manifest is stored off-chain, and each record's Merkle proof is returned. By default each record is also
registered on-chain so it can be read through the API; send `register=false` to skip that per-record
cost (records stay provable via `RecordAnchor.verifyInclusion` but are not readable through the API).

## Suggested walkthrough

1. Log in as **doctor1**, upload a file for **patient1**'s address (shown in the seed output /
   `backend/src/chain/users.json`) — this anchors a record.
2. Log in as **patient1**, grant consent to **doctor1**'s address for purpose `treatment`.
3. Log in as **doctor1** again, request access to the record with purpose `treatment` — should
   succeed and let you download the decrypted file. Try purpose `billing` instead — should be denied
   (purpose-bound consent, contribution b).
4. Log in as **erdoctor1** (the emergency responder) and use break-glass access on **patient1**'s
   record without any consent — succeeds, but writes an `isEmergency` audit entry and flips
   `patient1`'s pending-notification flag.
5. Log in as **patient1** again — the pending-notification banner should be visible, and the audit
   trail should show the emergency entry.
6. Log in as **auditor1** and pull up **patient1**'s full audit trail.

## Security notes / prototype disclaimers

These are intentional, disclosed simplifications for a research prototype, not oversights — each is
also called out in the paper's Discussion/Limitations section:

- **Demo login is not a real identity system.** `backend/src/chain/users.json` maps a username/password
  to a private key derived from Hardhat's public default development mnemonic. This is fine for a local
  demo and unsafe for anything else; a production deployment needs real client-held keys or wallet
  integration (MetaMask/WalletConnect), not server-custodied keys.
- **Key custody for record encryption is centralized** (`backend/src/services/keystore.js`): the backend
  process can decrypt any record. This is the trade-off documented in PLAN.md Section 2 for not choosing
  proxy re-encryption as one of the three contributions.
- **Off-chain storage is a local content-addressed folder, not real IPFS** (`backend/src/services/storage.js`),
  clearly labeled as such; swapping in a real Kubo/IPFS daemon only requires changing that one file.
- **"Permissioned" is enforced by Solidity `AccessControl` roles, not network-level MSP identity** — see
  PLAN.md Section 3 for why Hyperledger Fabric was not used in this environment, and what that trade-off means.
