#!/usr/bin/env python3
"""Verify full catalog coverage, placeholders and locale pack parity."""

import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CATALOGS = ROOT / "dist/locales"
RUNTIME = ROOT / "dist/i18n.mjs"
SINGLE_AUDIT = ROOT / "scripts/i18n-audit.py"
COMMON_ENGLISH_WORDS = {
    "the", "and", "from", "with", "for", "not", "you", "your", "this", "that", "a", "an",
    "is", "are", "to", "in", "on", "of", "it", "as", "be", "use", "do", "or", "when",
    "where", "who", "what", "how", "can", "may", "must", "before", "after", "only", "all",
    "both", "each", "other", "any", "if", "than", "does", "into", "by", "at", "while",
    "during", "under", "over", "up", "down", "between", "out", "through", "until", "because",
    "instead", "will", "would", "could", "should", "has", "have", "had", "was", "were", "been",
    "being", "keep", "start", "stop", "choose", "match", "check", "read", "send", "works", "work",
}


def main():
    source = RUNTIME.read_text(encoding="utf-8")
    locales = re.findall(r"^\s*\['([^']+)'\s*,", source, flags=re.M)
    expected = set(locales)
    ready_match = re.search(r"readyLocales\s*=\s*new Set\(\[([^]]*)\]\)", source)
    if not ready_match:
        raise SystemExit("Could not find the runtime enabled-locale set.")
    ready = set(re.findall(r"'([^']+)'", ready_match.group(1)))
    if ready != expected:
        print("Runtime enabled-locale mismatch:")
        if expected - ready:
            print("  Disabled: " + ", ".join(sorted(expected - ready)))
        if ready - expected:
            print("  Unknown: " + ", ".join(sorted(ready - expected)))
        raise SystemExit(1)
    found = {path.stem for path in CATALOGS.glob("*.json")}
    missing_files = sorted(expected - found)
    extra_files = sorted(found - expected)
    if missing_files or extra_files:
        if missing_files:
            print("Missing locale catalogs:", ", ".join(missing_files))
        if extra_files:
            print("Unexpected locale catalogs:", ", ".join(extra_files))
        raise SystemExit(1)

    master = json.loads((CATALOGS / "en.json").read_text(encoding="utf-8"))
    master_keys = set(master)
    if len(master_keys) != len(master):
        raise SystemExit("English source catalog contains duplicate keys.")

    for locale in locales:
        path = CATALOGS / f"{locale}.json"
        catalog = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(catalog, dict):
            raise SystemExit(f"{locale}: catalog must be an object.")
        keys = set(catalog)
        if keys != master_keys:
            missing = sorted(master_keys - keys)
            extra = sorted(keys - master_keys)
            print(f"{locale}: key parity failed ({len(missing)} missing, {len(extra)} extra)")
            if missing:
                print("  Missing:", "; ".join(missing))
            if extra:
                print("  Extra:", "; ".join(extra))
            raise SystemExit(1)
        blanks = sorted(key for key, value in catalog.items() if not isinstance(value, str) or not value.strip())
        if blanks:
            print(f"{locale}: {len(blanks)} empty or non-string messages")
            raise SystemExit(1)
        unchanged_english = []
        if locale != "en":
            for key, value in catalog.items():
                if key != value or len(key) < 35:
                    continue
                words = {word.lower() for word in re.findall(r"[A-Za-z]+", key)}
                if words & COMMON_ENGLISH_WORDS:
                    unchanged_english.append(key)
        if unchanged_english:
            print(f"{locale}: {len(unchanged_english)} long English messages remain untranslated")
            for key in unchanged_english[:20]:
                print("  " + key)
            if len(unchanged_english) > 20:
                print(f"  …and {len(unchanged_english) - 20} more")
            raise SystemExit(1)
        if locale != "en":
            morse_sample = catalog.get("HELLO WORLD", "")
            supported_morse = set("ABCDEFGHIJKLMNOPQRSTUVWXYZÉ0123456789 .,:?'-/()\"=+@")
            unsupported = sorted(set(morse_sample.upper()) - supported_morse)
            if not morse_sample or morse_sample == "HELLO WORLD" or unsupported:
                print(f"{locale}: Morse sample must be localized using supported characters; unsupported: {unsupported}")
                raise SystemExit(1)

        result = subprocess.run(
            [sys.executable, str(SINGLE_AUDIT), locale],
            cwd=ROOT,
            check=False,
            text=True,
            capture_output=True,
        )
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        if result.returncode:
            raise SystemExit(result.returncode)
        print(f"{locale}: exact key parity; {len(catalog)} non-empty messages")


if __name__ == "__main__":
    main()
