#!/usr/bin/env python3
"""
Generates LaTeX table fragments (\\begin{tabular}...\\end{tabular}, no
surrounding \\table/\\caption -- those live in the .tex section files that
\\input{} these) directly from the CSVs in experiments/results/, per the
brief's instruction: "Generate tables from the CSVs with a script instead of
typing them by hand." Every number in these tables must therefore trace back
to a real CSV row; if a CSV is missing, this script writes a clearly marked
placeholder .tex fragment instead of inventing numbers.

Output: paper/figures/tables/*.tex
"""
import csv
import os

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "..", "results")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "paper", "figures", "tables")


def read_csv(name):
    path = os.path.join(RESULTS_DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def esc(s):
    return str(s).replace("_", r"\_").replace("%", r"\%")


def header_cell(h):
    # A bare `\\` inside a tabular cell (even nested in \textbf{}) is parsed
    # as a row separator by the enclosing array, not a line break --
    # `\shortstack` is the standard fix: it scopes its own `\\` inside a
    # self-contained box, so multi-line headers render correctly.
    if "\\\\" in h:
        return f"\\textbf{{\\shortstack{{{h}}}}}"
    return f"\\textbf{{{h}}}"


def write_tex(name, content):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, "w") as f:
        f.write(content)
    print(f"Wrote {path}")


def placeholder(name, reason):
    write_tex(
        name,
        f"% PLACEHOLDER -- {reason}\n"
        f"% Run the corresponding experiments/scripts/bench-*.js script and re-run\n"
        f"% generate_tables.py before submission. This fragment intentionally\n"
        f"% contains no numbers so it cannot be silently left in the final PDF.\n"
        f"\\begin{{tabular}}{{l}}\\toprule TODO: results not yet generated \\\\ \\bottomrule\\end{{tabular}}\n",
    )


def comparison_table():
    rows = read_csv("comparison-table.csv")
    if not rows:
        return placeholder("comparison_table.tex", "comparison-table.csv missing")

    cols = ["System", "Permissioned", "FineGrainedConsent", "EmergencyAccess", "OffChainEncryption", "AuditTrail", "Interoperability"]
    header_labels = ["System", "Perm.", "Fine-grained\\\\consent", "Emergency\\\\access", "Off-chain\\\\encryption", "Audit\\\\trail", "Interop."]

    lines = []
    lines.append("\\begin{tabular}{l" + "c" * (len(cols) - 1) + "}")
    lines.append("\\toprule")
    lines.append(" & ".join(header_cell(h) for h in header_labels) + " \\\\")
    lines.append("\\midrule")
    for r in rows:
        lines.append(" & ".join(esc(r[c]) for c in cols) + " \\\\")
    lines.append("\\bottomrule")
    lines.append("\\end{tabular}")
    write_tex("comparison_table.tex", "\n".join(lines) + "\n")


def latency_table():
    rows = read_csv("latency-throughput-summary.csv")
    if not rows:
        return placeholder("latency_table.tex", "latency-throughput-summary.csv missing (run bench-latency-throughput.js)")

    cols = ["operation", "n", "meanLatencyMs", "p50LatencyMs", "p95LatencyMs", "throughputTps"]
    header_labels = ["Operation", "$n$", "Mean (ms)", "p50 (ms)", "p95 (ms)", "Throughput (tx/s)"]
    lines = ["\\begin{tabular}{lccccc}", "\\toprule", " & ".join(f"\\textbf{{{h}}}" for h in header_labels) + " \\\\", "\\midrule"]
    for r in rows:
        lines.append(" & ".join(esc(r[c]) for c in cols) + " \\\\")
    lines += ["\\bottomrule", "\\end{tabular}"]
    write_tex("latency_table.tex", "\n".join(lines) + "\n")


def anchoring_table():
    rows = read_csv("anchoring-cost.csv")
    if not rows:
        return placeholder("anchoring_table.tex", "anchoring-cost.csv missing (run bench-anchoring-cost.js)")

    cols = ["batchSize", "individualGasPerRecord", "batchRootGasPerRecordAmortized", "batchRegisterGasPerRecord"]
    header_labels = ["Batch size", "Individual\\\\(gas/record)", "Batched root\\\\(gas/record, amortized)", "Per-record registration\\\\(gas/record, optional)"]
    lines = ["\\begin{tabular}{lccc}", "\\toprule", " & ".join(header_cell(h) for h in header_labels) + " \\\\", "\\midrule"]
    for r in sorted(rows, key=lambda r: int(r["batchSize"])):
        lines.append(" & ".join(esc(r[c]) for c in cols) + " \\\\")
    lines += ["\\bottomrule", "\\end{tabular}"]
    write_tex("anchoring_table.tex", "\n".join(lines) + "\n")


def encryption_table():
    rows = read_csv("encryption-overhead-summary.csv")
    if not rows:
        return placeholder("encryption_table.tex", "encryption-overhead-summary.csv missing (run bench-encryption-overhead.js)")

    cols = ["sizeLabel", "meanEncryptMs", "meanDecryptMs", "throughputEncryptMBps", "throughputDecryptMBps"]
    header_labels = ["Record size", "Encrypt (ms)", "Decrypt (ms)", "Encrypt (MB/s)", "Decrypt (MB/s)"]
    lines = ["\\begin{tabular}{lcccc}", "\\toprule", " & ".join(f"\\textbf{{{h}}}" for h in header_labels) + " \\\\", "\\midrule"]
    for r in rows:
        lines.append(" & ".join(esc(r[c]) for c in cols) + " \\\\")
    lines += ["\\bottomrule", "\\end{tabular}"]
    write_tex("encryption_table.tex", "\n".join(lines) + "\n")


if __name__ == "__main__":
    comparison_table()
    latency_table()
    anchoring_table()
    encryption_table()
