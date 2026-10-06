#!/usr/bin/env python3
"""
Generates publication-quality plots (PLAN.md Phase 2) from the CSVs each
bench-*.js script writes to experiments/results/. Requires all five
bench-*.js scripts to have been run first against a live local Hardhat
network -- this script refuses to fabricate a plot for a CSV that does not
exist, per the "never invent numbers" instruction; it prints a clear
placeholder message and skips that figure instead.

Output: paper/figures/plots/*.pdf (vector PDF, serif font, grayscale-legible
via hatching + line-style redundancy alongside color, consistent style
across all five figures).

Usage:
    pip install -r requirements.txt
    python plot_results.py
"""
import csv
import os
import sys

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "..", "results")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "paper", "figures", "plots")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    print("matplotlib is not installed. Run: pip install -r requirements.txt")
    sys.exit(1)

plt.rcParams.update({
    "font.family": "serif",
    "font.size": 9,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "grid.linestyle": "--",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "figure.dpi": 150,
})

# Grayscale-legible: every series gets both a distinct hatch/marker AND color.
HATCHES = ["", "//", "xx", "..", "\\\\"]
MARKERS = ["o", "s", "^", "D", "v"]
GRAYS = ["0.15", "0.4", "0.6", "0.75"]


def read_csv(name):
    path = os.path.join(RESULTS_DIR, name)
    if not os.path.exists(path):
        print(f"[SKIP] {name} not found -- run the corresponding bench-*.js script first. "
              f"No placeholder numbers will be plotted.")
        return None
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def savefig(fig, name):
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, name)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    print(f"Wrote {out_path}")


def plot_latency_throughput():
    rows = read_csv("latency-throughput-summary.csv")
    if not rows:
        return
    ops = [r["operation"] for r in rows]
    p50 = [float(r["p50LatencyMs"]) for r in rows]
    p95 = [float(r["p95LatencyMs"]) for r in rows]

    fig, ax = plt.subplots(figsize=(3.5, 1.9))
    x = range(len(ops))
    width = 0.35
    ax.bar([i - width / 2 for i in x], p50, width, label="p50", color=GRAYS[0], hatch=HATCHES[0], edgecolor="black")
    ax.bar([i + width / 2 for i in x], p95, width, label="p95", color=GRAYS[2], hatch=HATCHES[1], edgecolor="black")
    ax.set_xticks(list(x))
    ax.set_xticklabels(ops, rotation=30, ha="right", fontsize=7)
    ax.set_ylabel("Latency (ms)")
    ax.set_title("Per-operation transaction latency")
    ax.set_ylim(0, max(p95) * 1.35)
    ax.legend(frameon=False, loc="upper center", ncol=2, fontsize=7)
    savefig(fig, "latency_throughput.pdf")


def plot_concurrency():
    rows = read_csv("concurrency-summary.csv")
    if not rows:
        return
    levels = [int(r["concurrency"]) for r in rows]
    throughput = [float(r["throughputTps"]) for r in rows]
    p95 = [float(r["p95LatencyMs"]) if r["p95LatencyMs"] else float("nan") for r in rows]
    err_rate = [float(r["errorRatePct"]) for r in rows]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.0, 1.9))

    ax1.plot(levels, throughput, marker=MARKERS[0], color=GRAYS[0])
    ax1.set_xlabel("Concurrent clients")
    ax1.set_ylabel("Throughput (tx/s)")
    ax1.set_title("(a) Throughput vs. concurrency")

    ax2b = ax2.twinx()
    ax2.plot(levels, p95, marker=MARKERS[1], color=GRAYS[0], label="p95 latency")
    ax2b.plot(levels, err_rate, marker=MARKERS[2], color=GRAYS[2], linestyle="--", label="error rate")
    ax2.set_xlabel("Concurrent clients")
    ax2.set_ylabel("p95 latency (ms)")
    ax2b.set_ylabel("Error rate (%)")
    ax2.set_title("(b) Latency / error rate vs. concurrency")
    lines1, labels1 = ax2.get_legend_handles_labels()
    lines2, labels2 = ax2b.get_legend_handles_labels()
    ax2.legend(lines1 + lines2, labels1 + labels2, frameon=False, fontsize=7, loc="upper left")

    savefig(fig, "concurrency_scalability.pdf")


def plot_encryption_overhead():
    rows = read_csv("encryption-overhead-summary.csv")
    if not rows:
        return
    order = ["100KB", "1MB", "10MB"]
    rows = sorted(rows, key=lambda r: order.index(r["sizeLabel"]) if r["sizeLabel"] in order else 99)
    labels = [r["sizeLabel"] for r in rows]
    enc = [float(r["meanEncryptMs"]) for r in rows]
    dec = [float(r["meanDecryptMs"]) for r in rows]

    fig, ax = plt.subplots(figsize=(3.5, 1.9))
    x = range(len(labels))
    width = 0.35
    ax.bar([i - width / 2 for i in x], enc, width, label="Encrypt", color=GRAYS[0], hatch=HATCHES[0], edgecolor="black")
    ax.bar([i + width / 2 for i in x], dec, width, label="Decrypt", color=GRAYS[2], hatch=HATCHES[1], edgecolor="black")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_ylabel("Time (ms)")
    ax.set_title("AES-256-GCM overhead vs. record size")
    ax.legend(frameon=False, loc="upper left", fontsize=7)
    savefig(fig, "encryption_overhead.pdf")


def plot_anchoring_cost():
    rows = read_csv("anchoring-cost.csv")
    if not rows:
        return
    rows = sorted(rows, key=lambda r: int(r["batchSize"]))
    sizes = [int(r["batchSize"]) for r in rows]
    individual = [float(r["individualGasPerRecord"]) for r in rows]
    batched = [float(r["batchRootGasPerRecordAmortized"]) for r in rows]

    fig, ax = plt.subplots(figsize=(3.5, 1.9))
    ax.plot(sizes, individual, marker=MARKERS[0], color=GRAYS[0], label="Individual anchoring")
    ax.plot(sizes, batched, marker=MARKERS[1], color=GRAYS[2], linestyle="--", label="Merkle-batched (amortized)")
    ax.set_xlabel("Batch size (records)")
    ax.set_ylabel("Gas per record")
    ax.set_yscale("log")
    ax.set_title("Gas per record: individual vs. batched")
    ax.legend(frameon=False, fontsize=7)
    savefig(fig, "anchoring_cost.pdf")


def plot_naive_vs_abac():
    rows = read_csv("naive-vs-abac.csv")
    if not rows:
        return
    tx_rows = [r for r in rows if r["gasUsed"] not in ("", None)]

    def mean_gas(variant, operation):
        vals = [float(r["gasUsed"]) for r in tx_rows if r["variant"] == variant and r["operation"] == operation]
        return sum(vals) / len(vals) if vals else float("nan")

    pairs = [
        ("Grant", mean_gas("naive", "grant"), mean_gas("abac", "grantConsent")),
        (
            "Access check (tx)",
            float("nan"),
            mean_gas("abac", "checkAndLogAccess (tx, writes audit entry)"),
        ),
    ]
    naive_grant, abac_grant = pairs[0][1], pairs[0][2]
    abac_check = pairs[1][2]

    fig, ax = plt.subplots(figsize=(3.5, 1.9))
    width = 0.35
    b1 = ax.bar([-width / 2], [naive_grant], width, label="Naive boolean", color=GRAYS[0], hatch=HATCHES[0], edgecolor="black")
    b2 = ax.bar([width / 2, 1], [abac_grant, abac_check], width, label="ABAC (ConsentManager)", color=GRAYS[2], hatch=HATCHES[1], edgecolor="black")
    for bar in list(b1) + list(b2):
        ax.annotate(f"{bar.get_height() / 1000:.1f}k", (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    ha="center", va="bottom", fontsize=7)
    ax.text(1, abac_check * 0.5, "no naive\nequivalent", ha="center", va="center", fontsize=6, color="white")
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["Grant", "Access check\n(tx + audit entry)"])
    ax.set_ylabel("Gas used")
    ax.set_ylim(0, abac_grant * 1.75)
    ax.set_title("Consent cost: naive vs. ABAC")
    ax.legend(frameon=False, fontsize=7, loc="upper right")
    savefig(fig, "naive_vs_abac.pdf")


if __name__ == "__main__":
    plot_latency_throughput()
    plot_concurrency()
    plot_encryption_overhead()
    plot_anchoring_cost()
    plot_naive_vs_abac()
