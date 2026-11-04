# Invoice export: design

**Status:** approved by the user on 2026-11-03.

Finance wants to pull invoice totals into a spreadsheet, so `tally` gets an `export` command. While we are in here, fix the reported split rounding bug.

## Design
- New module `src/export.ts` with `toJson(store, taxRate)` and `toCsv(store, taxRate)`, both returning strings.
- `src/cli.ts` gains an `export` subcommand that parses `--format <json|csv>` and a file path, reuses `load()`, and writes the result to stdout.
- Exit codes: 0 on success, 1 on a file or data error (as today), 2 on a bad format.

## Requirements
- **R1 JSON export.** `node src/cli.ts export --format json <file>` prints a JSON array to stdout, one object per invoice in file order: `{"id": string, "customer": <customer name>, "totalCents": <invoiceTotal with the file's taxRate>}`. Exit code 0.
- **R2 CSV export.** `node src/cli.ts export --format csv <file>` prints a header line `id,customer,total`, then one line per invoice. `total` is formatted with `formatCents` (two decimals). A field that contains a comma or a double quote is wrapped in double quotes, with inner quotes doubled (RFC 4180). Exit code 0.
- **R3 Bad format.** Any other `--format` value, or a missing one, prints a message starting with `unknown format` to stderr, prints nothing to stdout, and exits with code 2.
- **R4 README.** README.md gets an `## Export` section that shows both commands and states that an unknown format exits with code 2.
- **R5 Split rounding (user report).** Users report that `split` hands out one cent too many: `split(1000, 3)` must return `[334, 333, 333]`, and the shares must always sum to the total.
- **R6 CHANGELOG.** CHANGELOG.md gets entries under `## Unreleased` for the export command and the split fix.

## Out of scope
- New dependencies. Other output formats. Changing `tally total`.
