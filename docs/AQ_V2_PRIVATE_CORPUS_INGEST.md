# AQ V2 Fresh Private Corpus Ingest

Purpose: let an independent evaluator register a fresh 48-case AQ V2 corpus without exposing prompt bodies to the repository, workflow dispatch metadata, logs, or artifacts.

## Secret boundary

The evaluator supplies the gzip+base64 sealed corpus through the GitHub Actions secret `ORIGIN_AQ_V2_FRESH_CORPUS_GZIP_B64`. The database connection remains in `POSTGRES_URL`.

The only workflow input is the non-secret `corpus_id`. Corpus content must never be pasted into a workflow input, issue, pull request, commit, log, or chat used by the engineering assistant.

## Validation and storage

The ingest script:

- decodes and gunzips the secret in runner memory;
- validates the sealed corpus schema and exact 48-case shape;
- verifies that the embedded corpus ID matches the explicit input;
- computes the stable corpus digest and the SHA-256 of the exact source JSON bytes;
- opens a serializable database transaction;
- rejects an existing corpus ID or corpus digest;
- inserts into `origin_eval_private.aq_v2_sealed_corpora`;
- writes only sanitized public identity: corpus ID, digest, source-file SHA-256, and case count.

## Operator sequence

1. Independent evaluator authors a fresh corpus outside the engineering assistant.
2. Evaluator gzip+base64 encodes the corpus and sets `ORIGIN_AQ_V2_FRESH_CORPUS_GZIP_B64` as a GitHub Actions secret.
3. Manually dispatch `AQ V2 private corpus ingest` from `main`, passing only the corpus ID.
4. Record the resulting public corpus digest/count artifact.
5. Delete/rotate the temporary corpus secret after successful ingest.
6. Run `AQ V2 trusted exact-candidate run` using the exact corpus ID and digest.

Do not reuse the historical consumed corpus as unseen final evidence.
