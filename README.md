# CareChain

**A layered, consent-aware blockchain architecture for decentralized healthcare information exchange.**

CareChain lets patients decide who may read their health records, for how long and for what purpose.
Clinical content stays encrypted off-chain; the blockchain stores only hashes, pointers and Merkle roots,
and keeps a tamper-evident audit trail of every access, including emergency "break-glass" access.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636)
![Hardhat](https://img.shields.io/badge/Hardhat-2.x-yellow)
![Node](https://img.shields.io/badge/Node.js-18%2B-339933)
![React](https://img.shields.io/badge/React-18-61DAFB)
![Status](https://img.shields.io/badge/status-research%20prototype-orange)

---

## Highlights

| Capability | What it does |
|---|---|
| **Time- and purpose-bound consent (ABAC)** | A patient grants a provider access for a time window, a stated purpose and a record scope. The smart contract enforces all three on every access. |
| **Break-glass emergency access** | Credentialed responders can override consent in an emergency, but only with a mandatory reason, a flagged audit entry, a patient-notification obligation and a per-responder daily limit. |
| **Merkle-batched anchoring** | Many record hashes are anchored with a single Merkle root, which cuts the amortized gas per record by roughly 62x at batch size 50. |
| **Encrypted off-chain storage** | Records are encrypted with AES-256-GCM before storage. Only the hash and a content pointer go on-chain. |
| **Append-only audit log** | Grants, revocations, reads and emergency events are written to a shared on-chain audit trail that patients and auditors can read. |
| **Integrity on read** | The stored content is re-hashed on every read and compared with the anchored hash. Tampered content is rejected. |

## Architecture

```
 React UI  ──►  Express API  ──►  Smart contracts (Hardhat / EVM)
 (Vite)        JWT roles          CareChainRegistry   identities and roles
               AES-256-GCM        ConsentManager      ABAC consent
               ethers.js          RecordAnchor        hashes and Merkle batches
                  │               EmergencyAccess     break-glass
                  ▼               AuditLog            append-only trail
            Encrypted blob store
            (off-chain)
```

| Layer | Technology |
|---|---|
| Smart contracts | Solidity 0.8.24, OpenZeppelin Contracts 5.x (AccessControl, MerkleProof) |
| Build, test, local chain | Hardhat with Mocha/Chai |
| Backend | Node.js, Express 4, ethers.js 6, JSON Web Tokens, bcryptjs, multer, merkletreejs |
| Encryption | AES-256-GCM (Node.js `crypto`) |
| Front end | React 18, Vite 5 |

## Roles

| Role | Can do |
|---|---|
| Patient | Upload records, grant and revoke consent, read their own audit trail, receive emergency notifications |
| Provider | Request access to records under a valid consent |
| Emergency responder | Use break-glass access with a reason |
| Auditor | Read patient audit trails |
| Admin | Register patients and providers |

## Repository layout

| Path | Contents |
|---|---|
| [`implementation/`](implementation) | Solidity contracts and tests, Express backend, React front end |
| [`experiments/`](experiments) | Benchmark scripts, raw CSV/JSON results, table and plot generators |
| [`references/`](references) | Citation verification log |

Contract overview:

| Contract | Responsibility |
|---|---|
| `CareChainRegistry` | Identity and role registry (patient, provider, emergency responder, auditor, admin) |
| `ConsentManager` | Grant, revoke and check consents; log every access decision |
| `RecordAnchor` | Anchor single record hashes or Merkle batches; verify inclusion proofs |
| `EmergencyAccess` | Break-glass access with mandatory reason, rate limit and notification flag |
| `AuditLog` | Append-only audit trail written only by authorized contracts |

## Getting started

**Prerequisites:** Node.js 18 or newer and npm.

```bash
cd implementation
npm install
npm run compile
npm test
```

To run the full stack locally, use three terminals from `implementation/`:

```bash
npx hardhat node            # 1. local chain on http://127.0.0.1:8545
```

```bash
npm run seed:local          # 2. deploy the contracts and create demo users
cp .env.example .env
npm run backend             #    REST API on http://localhost:4000
```

```bash
cd frontend
npm install
npm run dev                 # 3. UI on http://localhost:5173
```

Then open http://localhost:5173 and sign in with one of the demo accounts: `patient1`, `patient2`,
`doctor1`, `erdoctor1` (emergency responder), `auditor1` or `admin`. The demo password is defined in
`implementation/scripts/seed-demo.js` and works on the local test chain only.

Detailed instructions, environment variables and the REST API are in
[`implementation/README.md`](implementation/README.md).

## Testing

| Command (from `implementation/`) | What it checks |
|---|---|
| `npm test` | 29 smart-contract tests, including negative cases. No running chain needed. |
| `npm run e2e` | 44 end-to-end checks across all roles. Needs the chain and backend running. |

## Experiments

The [`experiments/`](experiments) folder contains the scripts and raw results behind the performance
claims: anchoring gas cost, consent-check cost, encryption overhead, latency and throughput, and
concurrency. See [`experiments/README.md`](experiments/README.md) for how to reproduce them.

## Security notes

This is a **research prototype**. Please read these limits before reusing any part of it:

- It runs on a local single-node Hardhat chain, not a permissioned production network.
- Record encryption keys are held by the backend server.
- Demo users sign with Hardhat's publicly known development keys. Never use them on a real network.
- All data in the repository is synthetic. Do not use it with real patient data.

## License

No license has been specified yet. All rights reserved by the authors until one is added.
