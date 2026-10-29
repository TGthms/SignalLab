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

## EAS event reference

`dist/eas-events.mjs` lists the EAS event codes in [47 CFR § 11.31(e)](https://www.ecfr.gov/current/title-47/section-11.31), consulted October 28, 2026. Short explanations are educational paraphrases informed by the [NOAA event-code overview](https://www.weather.gov/dsb/eventcodes) and its [non-weather emergency message descriptions](https://www.weather.gov/meg/nonwxrelatedemergmesg). The event code is only a classification; it does not convey the entire announcement or authorize playback or transmission. Snow Squall Warning (SQW) is not included in the FCC list; NOAA notes it is not conveyed to EAS. Event-reference names, explanations, and categories are provided in every supported language. The translations describe the FCC's U.S. codes for study; the code and applicable local plans remain authoritative.

The location browser exposes the bundled county and territory directory snapshot; it does not claim to contain marine zones or polygon boundaries. For marine coverage consult [NOAA's marine zones and SAME guide](https://www.weather.gov/marine/nws_dissemination). A partition selection does not imply that local officials have defined that partition.
