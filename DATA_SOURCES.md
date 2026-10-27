# Geographic data provenance

`dist/data/same-codes.txt` is the NOAA National Weather Service SAME location directory, retrieved on October 25, 2026 from:

https://www.weather.gov/source/nwr/SameCode.txt

It is linked from https://www.weather.gov/nwr/Counties.

`dist/data/locations.json` contains the 3,295 parsed entries, preserving six-digit code, directory name, and state/territory abbreviation. State names are expanded by `dist/locations.mjs`. The application presents this as a snapshot, not a current assignment authority; NOAA's directory can include legacy entries and is distinct from current Census county-equivalent definitions.

The official field name and partition explanations follow:

- https://www.weather.gov/nwr/usingsame
- https://www.weather.gov/dsb/nwr_sameenz
- https://www.weather.gov/pca/technical
- https://www.weather.gov/media/directives/010_pdfs_archived/pd01017012a.pdf

A non-zero partition label does not establish that a particular partition is officially used in a county. The app says “only where locally defined” and links to NOAA. Unknown names remain unknown rather than guessed.

## International Morse

The character mappings and 1:3 mark / 1:3:7 spacing ratios follow [ITU-R M.1677-1 (October 2009)](https://www.itu.int/rec/R-REC-M.1677-1-200910-I/en). This app implements A–Z, É, digits and the punctuation shown in its chart; procedural prosigns and arbitrary Unicode are not encoded in this mode. The UI links [ARRL learning material](https://www.arrl.org/learning-morse-code/) and [W1AW practice files](https://www.arrl.org/code-practice-files); no external practice audio is bundled.
