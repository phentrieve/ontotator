# icd10cm.json: an ICD-10-CM excerpt for tests

`icd10cm.json` holds 130 codes of ICD-10-CM FY2027 (valid from 1 October 2026) as an OBO Graph JSON ontology with the prefix `ICD10CM`. Its job is to test real ICD-10-CM codes: ids with dots and letters (`ICD10CM:E11.621`, `ICD10CM:T36.0X1A`), the term search, the ontology tree and the project settings for term codes.

- **Source:** the ICD-10-CM tabular list, file `icd10cm-tabular_-2027.xml` in `icd10cm-table-and-index-2027.zip`, published by the National Center for Health Statistics (CDC/NCHS) at <https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/>.
- **Licence:** the ICD-10-CM files are a US government publication, free to use and in the public domain. ICD-10-CM adapts the WHO's ICD-10 (© WHO), with the WHO's permission for this US adaptation.
- **Content:** the chapters and blocks above the codes as parents (ids are their ranges, e.g. `ICD10CM:E08-E13`), and the categories E11 (type 2 diabetes; the eye complications only down to E11.31 … E11.39), N18 (chronic kidney disease), I10 (essential hypertension), J45 (asthma) and T36.0 (penicillins, with the 7th characters A, D and S). Labels are the tabular descriptions; inclusion terms are exact synonyms.
- **Rebuild:** `uv run python -I scripts/make_icd10cm_fixture.py icd10cm-tabular_-2027.xml tests/fixtures/icd10cm.json`.

It is an excerpt for tests, not a coding reference.
