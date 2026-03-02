# Design: Elixir emitter compression + worker consumer support

**Date:** 2025-03-02  
**Scope:** Same compression format as Node emitter (enc + compressed `data`) in the Elixir emitter; ensure btrz_worker_webhooks can consume both plain and compressed messages.

---

## 1. Context

- **Node emitter (btrz-webhooks-emitter):** Already sends optional `enc` ("zstd" | "gzip") and compresses only the `data` field when `WEBHOOK_COMPRESS` is set; top-level shape is `{ id, ts, providerId, event, data[, enc] }`.
- **Elixir emitter (btrz_ex_webhooks_emitter):** Builds the same shape in `build_message/2` (id, ts, providerId, event, data), encodes with Poison and sends to SQS. No compression today. Deploys on **Erlang 24** (no native zstd in stdlib; native zstd is Erlang 28+).
- **Worker (btrz_worker_webhooks):** Broadway consumes SQS; transformer does `message_data |> Jason.decode!() |> Webhook.cast()`. Expects JSON body with `id`, `ts`, `providerId`, `event`, `data` (object). Downstream code expects `data` to be a map (e.g. `data["_id"]`).
- **btrz_api_webhooks:** Only **emits** webhooks (via configured emitter) and manages undelivered/failed; it does **not** consume from SQS. No change needed for consumption; when it uses the Elixir emitter, compression will follow emitter config.

---

## 2. Elixir emitter (btrz_ex_webhooks_emitter)

### 2.1 Behaviour

- Read env **`WEBHOOK_COMPRESS`** at build time (same as Node): if value is `"zstd"` or `"gzip"` (case-insensitive), compress the `data` payload and set `enc`; otherwise leave message plain (no `enc`).
- Only the **`data`** field is compressed. Top-level keys `id`, `ts`, `providerId`, `event` (and optional `url`) stay uncompressed.
- Compressed `data`: JSON-encode the filtered data map → compress with chosen algorithm → base64-encode → store as string in `data`; set `enc` to `"zstd"` or `"gzip"`.

### 2.2 Algorithm support on Erlang 24

- **gzip:** Use Erlang’s **`:zlib`** (e.g. `:zlib.gzip/1`, `:zlib.gunzip/1`). No extra dependency.
- **zstd:** Erlang 24 has no native zstd. Use a Hex dependency:
  - **Recommendation:** **`ezstd`** (actively maintained, used by e.g. req, mongodb_driver, phoenix_bakery). It’s an Erlang NIF binding; works on Erlang 24.
  - Alternative: `ex_zstd_reloaded` if you prefer an Elixir wrapper; both support compress/decompress.

### 2.3 Implementation outline

- **Config / env:** In `build_message/2` (or a small helper), read `System.get_env("WEBHOOK_COMPRESS")`, normalize to lowercase, and accept only `"zstd"` or `"gzip"`; any other value or missing → no compression.
- **Compression helper module (e.g. `BtrzWebhooksEmitter.Compression`):**
  - `compress/2(data_map, algo)` where `algo` is `"zstd"` or `"gzip"`:
    - Encode: `data_map |> Poison.encode!() |> compress_raw(algo) |> Base.encode64()`
  - For gzip: use `:zlib.gzip/1`.
  - For zstd: use `:ezstd.compress/1` (or the API provided by the chosen lib).
- **`build_message/2`:** After `filter_fields`, if compress algo is set, call the compression helper and set `data` to the base64 string and add `enc: algo` to the message map; otherwise leave `data` as the map and do not add `enc`.
- **Optional:** Add `ezstd` only when `WEBHOOK_COMPRESS` is used in production (e.g. optional dependency or always depend and call only when algo is `"zstd"`). Simplest is to add it as a normal dependency and call it only when algo is zstd.

### 2.4 Message shape (unchanged)

- Plain: `%{ id: ..., ts: ..., providerId: ..., event: ..., data: %{...} }` (no `enc`).
- Compressed: `%{ id: ..., ts: ..., providerId: ..., event: ..., data: "<base64>", enc: "zstd" | "gzip" }`.
- Poison will encode atom keys to the same JSON keys as Node (e.g. `providerId`).

---

## 3. Worker (btrz_worker_webhooks)

### 3.1 Requirement

- Consume both **plain** messages (no `enc`; `data` is an object) and **compressed** messages (`enc` is `"zstd"` or `"gzip"`; `data` is a base64-encoded compressed JSON string).
- After parsing, the rest of the pipeline (Webhook struct, Formatter, PostWebhooks) must always receive `data` as a **map**, not a string.

### 3.2 Decompression point

- **Where:** In the Broadway **transformer** (`transform/2`). Today: `message_data |> Jason.decode!() |> Webhook.cast()`.
- **New flow:**
  1. Decode body: `body = Jason.decode!(message_data)`.
  2. If `body["enc"]` is `"zstd"` or `"gzip"`:
     - Take `body["data"]` (must be a string).
     - Base64-decode → decompress (zstd or gzip) → `Jason.decode!()` → use as `data`.
     - Replace `body["data"]` with this map.
  3. Drop or ignore `body["enc"]` for the rest of the pipeline (Webhook.cast only cares about id, ts, provider_id, event, data, url).
  4. Call `Webhook.cast(body)` as today.

### 3.3 Algorithm support in worker

- **gzip:** `:zlib.gunzip/1` (stdlib).
- **zstd:** Use the **same** Hex library as the emitter (e.g. **`ezstd`**) so both sides use the same format. Add `ezstd` to worker’s `mix.exs` and call `:ezstd.decompress/1` when `enc == "zstd"`.

### 3.4 Error handling

- If `enc` is unknown (e.g. `"br"`): either treat as plain (ignore enc and fail later if `data` is not a map) or log and move to undelivered. **Recommendation:** treat unknown `enc` as invalid; log and send to undelivered (or ack and dead-letter) so we don’t misinterpret payloads.
- If decompression or base64 decode fails: log, and handle like other corrupt messages (e.g. existing undelivered/corrupt path).

### 3.5 Backward compatibility

- Messages **without** `enc` (current format): decode as today; `data` stays a map. No change in behaviour.
- Messages **with** `enc`: decompress then pass map. Worker must be deployed before or together with emitters that start sending compressed messages.

---

## 4. btrz_api_webhooks

- No change required for **consuming** (it doesn’t read from SQS).
- When it **emits** via the Elixir emitter, behaviour is determined by the emitter’s `WEBHOOK_COMPRESS` env in the environment where the API runs. No code change in btrz_api_webhooks itself.

---

## 5. Rollout order

1. **Worker:** Deploy worker with decompression support (handles both plain and `enc` zstd/gzip).
2. **Emitters:** Enable compression on Node and/or Elixir emitters by setting `WEBHOOK_COMPRESS=zstd` (or `gzip`) where desired.

---

## 6. Testing

- **Elixir emitter:** Unit tests for `build_message/2` with `WEBHOOK_COMPRESS` unset, `gzip`, `zstd`, and invalid value; assert message shape and that decompressing (e.g. in test with same lib) yields original data.
- **Worker:** Unit tests for a small “decode + decompress” helper: plain JSON (no enc), enc zstd, enc gzip; assert final `data` is a map. Integration test: publish a compressed message (e.g. from Node or Elixir) and assert worker processes it and posts as expected.

---

## 7. Summary

| Component              | Action |
|------------------------|--------|
| **btrz_ex_webhooks_emitter** | Add `WEBHOOK_COMPRESS` env; add gzip (via `:zlib`) and zstd (via `ezstd`); compress only `data` and set `enc` when env is zstd/gzip. |
| **btrz_worker_webhooks**    | In transformer, after `Jason.decode!`, if `enc` is zstd/gzip then base64-decode + decompress + JSON-decode `data` and replace; add `ezstd` dep for zstd. Handle unknown enc and decompress errors. |
| **btrz_api_webhooks**        | No change (only emits via emitter). |

This keeps the same contract as the Node emitter and ensures the worker can consume both plain and compressed messages in a backward-compatible way.
