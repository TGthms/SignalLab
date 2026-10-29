#!/usr/bin/env python3
"""Report static page strings that a locale catalog does not translate."""

from argparse import ArgumentParser
from html.parser import HTMLParser
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PAGES = (ROOT / "dist/index.html", ROOT / "dist/privacy.html", ROOT / "dist/terms.html")
APP = ROOT / "dist/app.mjs"
LOCATIONS = ROOT / "dist/locations.mjs"
MODULES = tuple(sorted((ROOT / "dist").glob("*.mjs")))
SKIP_TEXT_TAGS = {"code", "pre", "script", "style", "textarea"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
TRANSLATABLE_ATTRIBUTES = {"aria-label", "aria-description", "placeholder", "title"}
SHORT_RUNTIME_MESSAGES = {
    "Echo", "Noise", "AGC", "on", "off", "balanced", "fast", "resilient", "Fast",
    "copy", "copies", "sensitivity", "Stop", "Live", "Starting", "Paused", "Available",
    "Unavailable", "Default microphone", "Releasing…", "Stopped", "Automatic", "Playback",
    "Playback and recording", "Screen kept awake", "Released by system",
    "Unavailable / keep screen awake manually", "Compatibility capture", "running", "suspended",
    "closed", "interrupted", "Screen kept awake", "Released by system",
}
STRUCTURED_ERROR_MESSAGES = {
    "Audio is still {state}. Tap Restart microphone.",
    "Unsupported Morse characters: {characters}. Use the Morse table, or Custom data for other text.",
}


class SourceCollector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.sources = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for name in TRANSLATABLE_ATTRIBUTES:
            value = attrs.get(name)
            if value and value.strip():
                self.sources.add(value.strip())
        if tag == "meta" and attrs.get("name") == "description" and attrs.get("content"):
            self.sources.add(attrs["content"].strip())
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]

    def handle_data(self, data):
        if data.strip() and not any(tag in SKIP_TEXT_TAGS for tag in self.stack):
            self.sources.add(data.strip())


def page_sources():
    collector = SourceCollector()
    for page in PAGES:
        collector.feed(page.read_text(encoding="utf-8"))
    return collector.sources


def location_sources():
    source = LOCATIONS.read_text(encoding="utf-8")
    states_match = re.search(r"export const STATES=\{(.*?)\};", source, re.S)
    partitions_match = re.search(r"export const PARTITIONS=\[(.*?)\];", source, re.S)
    values = set()
    if states_match:
        values.update(re.findall(r":'([^']+)'", states_match.group(1)))
    if partitions_match:
        values.update(re.findall(r"'([^']+)'", partitions_match.group(1)))
    values.update({"County / equivalent area", "Name not found in bundled NOAA directory"})
    return values


def runtime_sources():
    source = APP.read_text(encoding="utf-8")
    token = re.compile(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`", re.S)
    ignored_exact = {"ABCDEFGHIJKLMNOPQRSTUVWXYZÉ", "SAME header / "}
    ignored_prefixes = (
        "signal-lab-", "eas-dialog-", "morse-received-code", "earlier-reception-",
        "experiment-", "location-reference-", "event-reference-", "application/", "copy-slot ", "meta[", "(", "#", ".", "./",
    )
    ignored_suffixes = (".wav", ".txt", ".json", ".bin", ".mjs")
    sources = set()
    for match in token.finditer(source):
        value = match.group(0)
        if value.startswith("`") and "${" in value:
            continue
        value = value[1:-1]
        if value in ignored_exact or value.startswith(ignored_prefixes) or value.endswith(ignored_suffixes):
            continue
        if re.search(r"[A-Za-z]{3}", value) and (" " in value or len(value) > 18):
            sources.add(value)
    return sources | SHORT_RUNTIME_MESSAGES


def error_sources():
    messages = set()
    token = re.compile(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`", re.S)
    error_prefix = re.compile(r"(?:throw\s+(?:new\s+)?Error|reject\(Error|finish\(Error|new\s+DOMException)\s*\($")
    for module in MODULES:
        if module.name in {"i18n.mjs", "ui-navigation.mjs"}:
            continue
        source = module.read_text(encoding="utf-8")
        for match in token.finditer(source):
            prefix = source[max(0, match.start() - 90):match.start()]
            if not error_prefix.search(prefix):
                continue
            value = match.group(0)
            if value.startswith("`") and "${" in value:
                value = re.sub(r"\$\{[^{}]*\}", "{value}", value[1:-1])
            else:
                value = value[1:-1]
            if re.search(r"[A-Za-z]{3}", value):
                messages.add(value)
    return messages | STRUCTURED_ERROR_MESSAGES


def runtime_templates():
    source = APP.read_text(encoding="utf-8")
    token = re.compile(r"`(?:\\.|[^`\\])*`", re.S)
    results = set()
    for match in token.finditer(source):
        value = match.group(0)[1:-1]
        if "${" not in value:
            continue
        value = re.sub(r"\$\{[^{}]*\}", "{}", value)
        if "${" in value:
            continue
        value = re.sub(r"\{[A-Za-z][A-Za-z0-9_]*\}", "{}", value)
        if re.search(r"[A-Za-z]{3}", value) and " " in value and not value.startswith(("#", "CCC ")):
            results.add(value)
    return results


def main():
    parser = ArgumentParser()
    parser.add_argument("locale", help="locale code, such as es or pt-BR")
    args = parser.parse_args()
    catalog_path = ROOT / "dist/locales" / f"{args.locale}.json"
    if not catalog_path.exists():
        raise SystemExit(f"Missing catalog: {catalog_path}")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(catalog, dict):
        raise SystemExit("Locale catalog must be a JSON object keyed by English source text.")
    sources = page_sources() | runtime_sources() | location_sources() | error_sources()
    missing = sorted(source for source in sources if not isinstance(catalog.get(source), str) or not catalog[source].strip())
    normalize = lambda value: re.sub(r"\{[A-Za-z][A-Za-z0-9_]*\}", "{}", value)
    catalog_templates = {normalize(source) for source, target in catalog.items() if isinstance(target, str) and target.strip()}
    missing_templates = sorted(source for source in runtime_templates() if source not in catalog_templates)
    missing.extend(f"[template] {source}" for source in missing_templates)
    placeholder_pattern = re.compile(r"\{([A-Za-z][A-Za-z0-9_]*)\}")
    placeholder_errors = []
    for source, target in catalog.items():
        if not isinstance(target, str) or not target.strip():
            continue
        expected = sorted(placeholder_pattern.findall(source))
        actual = sorted(placeholder_pattern.findall(target))
        if expected != actual:
            placeholder_errors.append((source, expected, actual))
    if missing:
        print(f"{args.locale}: {len(missing)} of {len(sources)} page and runtime strings need translation")
        for source in missing:
            print(source)
        raise SystemExit(1)
    if placeholder_errors:
        print(f"{args.locale}: {len(placeholder_errors)} placeholder mismatches")
        for source, expected, actual in placeholder_errors:
            print(f"{source}\n  expected: {expected}\n  found:    {actual}")
        raise SystemExit(1)
    print(f"{args.locale}: all {len(sources)} scanned page and runtime strings have catalog entries (event-reference packs checked separately)")


if __name__ == "__main__":
    main()
