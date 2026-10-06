# CareChain — Experiments

Benchmark scripts for the six experiments in [`/PLAN.md`](../PLAN.md) Section 4. Every script writes
real CSVs from a real local run against the deployed contracts in `/implementation`. The CSVs checked
in under `results/` come from a run on the machine described in `results/hardware-spec.txt`; every
number in the paper is generated from them (`plot_results.py`, `generate_tables.py`).

**Reproducibility notes.** Gas figures are deterministic and reproduce to within ~0.02% across runs,
*provided the chain is freshly started and seeded* -- `checkAndLogAccess` scans all of a patient's
consents, so its gas grows with how many consents that patient already has. Latency/throughput numbers
are wall-clock and vary run to run (we saw up to ~40% on 10 MB encryption time on a shared laptop).

## Prerequisites

- Node.js 18+ / npm
- Python 3.9+ with `pip install -r scripts/requirements.txt` (matplotlib)
- `/implementation` already set up: `npm install && npm run compile` there

## Run order

```bash
npm install   # from experiments/
```

```bash
# terminal 1, from /implementation
npx hardhat node
```

```bash
# terminal 2, from /implementation (once, after the node above is running)
npm run seed:local
```

```bash
# terminal 3, from /experiments
npm run bench:latency        # Experiment 1 -> results/latency-throughput*.csv
npm run bench:concurrency    # Experiment 2 -> results/concurrency*.csv
npm run bench:encryption     # Experiment 3 -> results/encryption-overhead*.csv (no chain needed)
npm run bench:anchoring      # Experiment 4 -> results/anchoring-cost.csv
npm run bench:consent-overhead  # Experiment 5 -> results/naive-vs-abac.csv
```

Experiment 6 (break-glass audit completeness) is verified by the Hardhat test suite in
`/implementation/test/EmergencyAccess.test.js`, not a separate benchmark script — it is a correctness
property (100% of emergency calls produce an audit entry), not a performance number.

## Generating plots and LaTeX tables

```bash
python scripts/plot_results.py     # -> ../paper/figures/plots/*.pdf
python scripts/generate_tables.py  # -> ../paper/figures/tables/*.tex
```

Both scripts skip (and print a clear message, never fabricate) any figure/table whose source CSV is
missing. `comparison-table.csv` is the one hand-authored input (a literature-derived qualitative
feature matrix, not a runtime measurement) — everything else must come from a bench script run.

## Files

```
results/
  hardware-spec.txt              real spec of the test machine (already captured)
  comparison-table.csv            hand-authored literature comparison (see PLAN.md Section 1)
  gas-report.txt                  written by Hardhat's gas reporter during `npm test` in /implementation
  *.csv                            written by the bench-*.js scripts above
scripts/
  lib/chain.js, lib/csv.js         shared helpers
  bench-*.js                       the five benchmark scripts
  plot_results.py                  CSV -> paper/figures/plots/*.pdf
  generate_tables.py               CSV -> paper/figures/tables/*.tex
```
