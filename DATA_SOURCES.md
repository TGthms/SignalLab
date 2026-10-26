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
