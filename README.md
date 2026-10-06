# CareChain

A decentralized healthcare information exchange prototype and the IEEE-format paper describing it.

Three contributions, each implemented, tested and measured:

1. **Time- and purpose-bound (ABAC) consent** enforced by a smart contract.
2. **Break-glass emergency access** with a mandatory, flagged audit entry, a patient-notification
   obligation and a per-responder rate limit.
3. **Merkle-batched record anchoring** (about 62x lower amortized gas per record at batch size 50).

Clinical records are AES-256-GCM encrypted and stored off-chain; only hashes, pointers and Merkle
roots go on-chain.

| Folder | What it is |
|---|---|
| [`implementation/`](implementation) | Solidity contracts + tests, Express backend, React frontend (see its README for one-command setup) |
| [`experiments/`](experiments) | Benchmark scripts, raw CSVs, plot/table generators |
| [`paper/`](paper) | LaTeX source (IEEEtran), TikZ figures, `refs.bib`, compiled `main.pdf` |
| [`references/`](references) | Citation verification log |
| [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md) | Honest status and open items |

Quick check (Node 18+):

```bash
cd implementation && npm install && npm test
```

**This is a research prototype.** It runs on a local single-node Hardhat chain (not Hyperledger Fabric),
uses server-held keys for record encryption, and logs in demo users with Hardhat's publicly known
development keys. See the paper's Discussion section and `implementation/README.md` for the full list
of limitations. Do not use it with real patient data.
