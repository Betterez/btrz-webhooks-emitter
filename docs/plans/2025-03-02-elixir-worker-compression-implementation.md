# Elixir Emitter + Worker Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add WEBHOOK_COMPRESS (zstd/gzip) to the Elixir webhooks emitter and decompression support in the worker so both plain and compressed SQS messages are consumed correctly.

**Architecture:** Emitter reads env at build time and compresses only the `data` field (JSON → compress → base64), setting `enc`. Worker, in the Broadway transformer, after JSON decode checks `enc` and decompresses `data` when present; rest of pipeline always receives `data` as a map.

**Tech Stack:** Elixir, Poison/Jason, Erlang :zlib (gzip), ezstd Hex package (zstd), Broadway/BroadwaySQS.

**Repositories:** Implementation touches two repos outside this workspace: `btrz_ex_webhooks_emitter` and `btrz_worker_webhooks` (sibling dirs under `betterez/`).

---

## Part A: Elixir emitter (btrz_ex_webhooks_emitter)

**Repo path:** `../btrz_ex_webhooks_emitter` from this repo, or absolute: `/Users/hernangarcia/Projects/betterez/btrz_ex_webhooks_emitter`

### Task 1: Add ezstd dependency

**Files:**
- Modify: `mix.exs` (deps section)

**Step 1:** Add ezstd to deps.

In `deps do`, add:
```elixir
{:ezstd, "~> 1.0"},
```

**Step 2:** Install deps.

Run: `cd /Users/hernangarcia/Projects/betterez/btrz_ex_webhooks_emitter && mix deps.get`
Expected: ezstd fetched and compiled.

**Step 3:** Commit (in btrz_ex_webhooks_emitter repo).

```bash
cd /Users/hernangarcia/Projects/betterez/btrz_ex_webhooks_emitter
git add mix.exs mix.lock
git commit -m "chore: add ezstd for zstd compression"
```

---

### Task 2: Compression module and get_compress_algo helper

**Files:**
- Create: `lib/compression.ex`

**Step 1:** Create the module.

Create `lib/compression.ex` with:
- `get_compress_algo/0`: reads `System.get_env("WEBHOOK_COMPRESS")`, normalizes to lowercase, returns `"zstd"` or `"gzip"` only; otherwise `nil`.
- `compress/2(data_map, algo)`: encodes data_map with Poison, compresses with algo (gzip via `:zlib.gzip/1`, zstd via `:ezstd.compress/1`), returns `Base.encode64(compressed)`.

**Step 2:** Run compile.

Run: `cd /Users/hernangarcia/Projects/betterez/btrz_ex_webhooks_emitter && mix compile`
Expected: compiles without error.

**Step 3:** Commit.

```bash
git add lib/compression.ex
git commit -m "feat: add Compression module for gzip/zstd"
```

---

### Task 3: Emitter unit tests for compression (TDD)

**Files:**
- Modify: `test/btrz_webhooks_emitter_test.exs` (or create if missing; check existing test file name)

**Step 1:** Find existing test file.

Run: `ls /Users/hernangarcia/Projects/betterez/btrz_ex_webhooks_emitter/test/`
Use the file that tests `BtrzWebhooksEmitter` (e.g. `btrz_webhooks_emitter_test.exs`).

**Step 2:** Write failing tests for build_message with WEBHOOK_COMPRESS.

- Test: when WEBHOOK_COMPRESS is unset, `build_message` returns no `enc` and `data` is a map.
- Test: when WEBHOOK_COMPRESS=zstd, message has `enc: "zstd"` and `data` is a base64 string; decompressing (with :ezstd.decompress and Base.decode64!) and Poison.decode! yields original data map.
- Test: when WEBHOOK_COMPRESS=gzip, message has `enc: "gzip"` and decompressing with :zlib.gunzip yields original data.
- Test: when WEBHOOK_COMPRESS=invalid, no enc and data is map.
- Use `System.put_env`/cleanup in test or run in isolated process so env doesn’t leak.

**Step 3:** Run tests to verify they fail (build_message not yet using compression).

Run: `mix test`
Expected: new tests fail (no enc / data not compressed).

**Step 4:** Commit (failing tests).

```bash
git add test/
git commit -m "test: add WEBHOOK_COMPRESS tests for build_message"
```

---

### Task 4: Wire build_message to compression

**Files:**
- Modify: `lib/btrz_ex_webhooks_emitter.ex` (build_message and message assembly)

**Step 1:** In `build_message/2`, after computing filtered data:
- Call `BtrzWebhooksEmitter.Compression.get_compress_algo/0`.
- If algo is non-nil: call `BtrzWebhooksEmitter.Compression.compress/2(filtered_data, algo)`, set message `data` to that string and add `enc: algo` to the message map.
- If algo is nil: leave `data` as the filtered map and do not add `enc`.

**Step 2:** Run tests.

Run: `mix test`
Expected: all tests pass.

**Step 3:** Commit.

```bash
git add lib/btrz_ex_webhooks_emitter.ex
git commit -m "feat: compress data in build_message when WEBHOOK_COMPRESS is zstd or gzip"
```

---

## Part B: Worker (btrz_worker_webhooks)

**Repo path:** `/Users/hernangarcia/Projects/betterez/btrz_worker_webhooks`

### Task 5: Add ezstd dependency to worker

**Files:**
- Modify: `mix.exs`

**Step 1:** Add `{:ezstd, "~> 1.0"}` to deps.

**Step 2:** Run `mix deps.get` in worker repo.

**Step 3:** Commit.

```bash
cd /Users/hernangarcia/Projects/betterez/btrz_worker_webhooks
git add mix.exs mix.lock
git commit -m "chore: add ezstd for zstd decompression"
```

---

### Task 6: Decompression helper module (worker)

**Files:**
- Create: `lib/decompression.ex` (or `lib/webhook_decompression.ex`)

**Step 1:** Create module with `decompress_data_if_needed/1(body_map)`:
- If `body_map["enc"]` is `"zstd"`: base64 decode `body_map["data"]`, `:ezstd.decompress/1`, `Jason.decode!`, put back as `body_map["data"]`; remove or leave `enc`.
- If `body_map["enc"]` is `"gzip"`: base64 decode, `:zlib.gunzip/1`, Jason.decode!, put back as `body_map["data"]`.
- If `body_map["enc"]` is something else (or missing): return body_map unchanged (plain message).
- Return the updated body map so `data` is always a map when enc was zstd/gzip.

**Step 2:** Run compile.

Run: `mix compile`
Expected: success.

**Step 3:** Commit.

```bash
git add lib/decompression.ex
git commit -m "feat: add decompression helper for enc zstd/gzip"
```

---

### Task 7: Worker unit tests for decompression

**Files:**
- Create or modify: `test/decompression_test.exs`

**Step 1:** Write tests:
- Plain body (no enc): decompress_data_if_needed returns same map.
- Body with enc "zstd" and data base64(zstd(json)): after decompress_data_if_needed, data is the decoded map.
- Body with enc "gzip" and data base64(gzip(json)): same.
- Body with enc "br": treat as plain (no decompression); if data is string, test can expect we don’t decompress and leave as-is or handle per design (e.g. undelivered).

**Step 2:** Run tests.

Run: `mix test test/decompression_test.exs`
Expected: pass.

**Step 3:** Commit.

```bash
git add test/decompression_test.exs
git commit -m "test: decompression helper plain and enc zstd/gzip"
```

---

### Task 8: Integrate decompression into Broadway transformer

**Files:**
- Modify: `lib/broadway.ex` (transform/2)

**Step 1:** In `transform/2`, after `Jason.decode!(message_data)`:
- Call the new decompression helper with the decoded body (e.g. `BtrzWorkerWebhooks.Decompression.decompress_data_if_needed(body)`).
- Use the returned map for `Webhook.cast(...)`.

**Step 2:** Handle errors: if decompression fails (e.g. bad base64 or corrupt compressed payload), rescue and route to existing undelivered/corrupt path if one exists; otherwise ack and log or dead-letter per existing policy.

**Step 3:** Run full test suite.

Run: `mix test`
Expected: all tests pass.

**Step 4:** Commit.

```bash
git add lib/broadway.ex
git commit -m "feat: decompress webhook data in transformer when enc is zstd or gzip"
```

---

## Part C: Final checks

### Task 9: Emitter README and worker error handling

**Files:**
- Modify: `btrz_ex_webhooks_emitter/README.md` (document WEBHOOK_COMPRESS)
- Review: `btrz_worker_webhooks` transform rescue/undelivered for decompression errors

**Step 1:** In emitter README, add env var `WEBHOOK_COMPRESS`: optional, values `zstd` or `gzip` (case-insensitive); when set, `data` is compressed and `enc` set; when unset, plain.

**Step 2:** In worker, ensure decompression failure (e.g. invalid base64 or decompress error) is rescued in transform and handled like corrupt message (e.g. UndeliveredWebhook.save or existing corrupt path). Adjust if current rescue only catches Jason.decode! errors.

**Step 3:** Commit each repo.

---

## Execution summary

| Task | Repo | Description |
|------|------|-------------|
| 1 | btrz_ex_webhooks_emitter | Add ezstd dep |
| 2 | btrz_ex_webhooks_emitter | Compression module |
| 3 | btrz_ex_webhooks_emitter | Failing tests for build_message compression |
| 4 | btrz_ex_webhooks_emitter | Wire build_message to compression |
| 5 | btrz_worker_webhooks | Add ezstd dep |
| 6 | btrz_worker_webhooks | Decompression helper module |
| 7 | btrz_worker_webhooks | Decompression unit tests |
| 8 | btrz_worker_webhooks | Transformer integration |
| 9 | both | README + error handling review |
