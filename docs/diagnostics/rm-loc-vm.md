---
summary: "Operational note for the rm.loc OpenClaw VM deployment."
read_when:
  - Maintaining the rm.loc OpenClaw deployment
  - Verifying the live VM after upgrade, rollback, or reboot
title: "rm.loc VM"
---

# rm.loc VM

This repository is the source of truth for the `openclaw.rm.loc` deployment.

Target live state as of `2026-04-16`:

- Public entrypoint: `https://openclaw.rm.loc/`
- Runtime host: VM `openclaw-secure`
- Gateway service: `openclaw.service`
- Installed package: `openclaw@2026.4.14`
- Bind address: `127.0.0.1:18789`
- Active state dir: `/home/openclaw/.openclaw`
- WhatsApp channel: builtin bridge only
- Telegram channel: builtin bridge only
- SIP calling skill: external workspace repo `~/.openclaw/workspace/skills/sip-mvp-bridge`
- WhatsApp archive ingest: external workspace repo `~/.openclaw/workspace/integrations/wa-greenapi-ingest-skill`
- WhatsApp archive search skill: external workspace repo `~/.openclaw/workspace/skills/wa-memory-search`
- Obsidian journal skill: external workspace repo `~/.openclaw/workspace/skills/obsidian-journal`
- Obsidian synced vault: `/home/openclaw/.openclaw/workspace/obsidian-vaults/my_obsidian`
- Obsidian sync service: `obsidian-headless-sync.service`

## Service invariants

The live VM is considered correct only if all of the following stay true:

- `openclaw.service` runs from systemd, not from an ad hoc shell session.
- `OPENCLAW_HOME=/home/openclaw`
- `OPENCLAW_STATE_DIR=/home/openclaw/.openclaw`
- The Gateway binds to loopback on port `18789`.
- `plugins.load.paths` is empty in live config unless a tracked repo change says otherwise.
- Builtin `whatsapp` stays enabled. No local WhatsApp fork overlay should be loaded in production.
- `session.sendPolicy.default` stays `deny`, with explicit allow rules for:
  - `agent:main:main`
  - `agent:main:subagent:`
  - `agent:main:telegram:default:`
  - `agent:main:whatsapp:default:direct:+77762851993`

## Known footgun

A stale nested state directory previously existed at `/home/openclaw/.openclaw/.openclaw`.
It was moved out of the active state tree on `2026-03-12` to:

- `/home/openclaw/update-backups/openclaw-nested-state-20260312-fix`

Rules:

- Do not recreate or reuse the nested path as `OPENCLAW_STATE_DIR`.
- Do not treat Control UI `pairing required` on a fresh browser as a Gateway outage.
- First separate auth or pairing issues from actual Gateway health issues.

## Validation commands

Run from the hypervisor or another trusted admin host that already has the VM SSH key:

```bash
sudo ssh -i /root/.ssh/openclaw_vm_ed25519 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/root/.ssh/openclaw_vm_known_hosts \
  openclaw@192.168.122.86
```

Inside the VM, the minimum validation set is:

```bash
openclaw --version
systemctl is-active openclaw.service
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/
timeout 30s openclaw channels status --probe
openclaw config get plugins.load.paths
openclaw config get plugins.entries.whatsapp.enabled
```

Expected results:

- `openclaw --version` prints `2026.4.14`
- `systemctl is-active` prints `active`
- local `curl` returns `200`
- `channels status --probe` reports `Gateway reachable`
- `plugins.load.paths` is empty
- builtin `whatsapp` is enabled

## 2026-03-12 upgrade note

On `2026-03-12`, the VM was upgraded from `OpenClaw 2026.3.2` to `OpenClaw 2026.3.8`.

Post-upgrade validation passed:

- Gateway answered on `127.0.0.1:18789`
- `openclaw.service` stayed active after restart
- `Telegram default` probed healthy
- `WhatsApp default` probed as linked, running, and connected
- stale nested state was moved from the active tree into `update-backups`

## 2026-03-12 session policy fix

The Control UI main chat route uses session key `agent:main:main`.

Because the deployment uses `session.sendPolicy.default = deny`, the UI chat will fail with:

- `GatewayRequestError: send blocked by session policy`

unless `agent:main:main` is explicitly allowed.

The live VM now includes an allow rule for:

- `rawKeyPrefix = agent:main:main`

If this rule is removed, the Web Control UI can still open history but cannot send messages in the main chat session.

If the external page shows `Health Offline` while the local checks above pass, treat it as a UI auth or pairing problem first, not as a service outage.

## 2026-04-16 SIP outbound fix

The rm.loc deployment uses an external workspace skill for SIP calling:

- `~/.openclaw/workspace/skills/sip-mvp-bridge`

That skill is separate from this repository and separate from the bundled `voice-call` plugin.

Observed failure on `2026-04-16`:

- inbound SIP listen service was healthy and kept `1126` registered
- ad hoc outbound `call` runs failed with `EADDRINUSE 0.0.0.0:5066`
- root cause: `sip-mvp-bridge-listen.service` owned SIP port `5066`, and outbound bridge runs tried to bind the same local SIP port

Validated fix:

- `call` mode now uses separate defaults:
  - `SIP_CALL_LOCAL_PORT=5068`
  - `SIP_CALL_RTP_PORT=4002`
- `listen` mode remains on:
  - `SIP_LOCAL_PORT=5066`
  - `SIP_RTP_PORT=4000`

Manual verification on `2026-04-16`:

- `node scripts/sip-mvp-bridge.js call --to 1125 --say ...` reached `200 OK`, answered, and played TTS
- `node scripts/sip-mvp-bridge.js call --to +77762851993 --say ...` reached `200 OK`, answered, and played TTS

Operational rule:

- when diagnosing SIP on rm.loc, treat Asterisk registration health and outbound port collisions as separate checks
- if registration is green but outbound calls fail immediately, check for `EADDRINUSE` on `5066` first

## 2026-04-16 WhatsApp GreenAPI note

The rm.loc deployment currently uses two separate external workspace components for WhatsApp archive work:

- ingest runtime: `~/.openclaw/workspace/integrations/wa-greenapi-ingest-skill`
- search skill: `~/.openclaw/workspace/skills/wa-memory-search`

They are not the same thing:

- `wa-greenapi-ingest-skill` pulls and normalizes GREEN-API data into the live SQLite archive
- `wa-memory-search` only reads the SQLite archive for lookup and semantic search

Validated live state on `2026-04-16`:

- live archive DB: `/home/openclaw/.openclaw/workspace/wa_archive.db`
- `ingest-once --source queue --dry-run` completed successfully with no errors
- `ingest-once --source history --dry-run --max-events 3` completed successfully and normalized fresh events
- `embed_missing.py --db /home/openclaw/.openclaw/workspace/wa_archive.db --dry-run` reported no missing embeddings
- `./scripts/smoke_check.sh` in `wa-greenapi-ingest-skill` passed after syncing minitests with the current `_enrich_media_and_transcript(...)` signature

Important operational detail:

- the legacy hook archive file `~/.openclaw/workspace/data/wa-archive/messages.jsonl` stopped being the active source of truth
- by `2026-04-16`, it was stale while the SQLite archive was still receiving fresh data
- when debugging WhatsApp archive health on rm.loc, verify the SQLite DB and the GreenAPI ingest runtime first, not the old `wa-archive` hook

## 2026-04-18 WhatsApp scheduling note

The rm.loc deployment no longer uses OpenClaw `cron` agent turns for the three deterministic WhatsApp archive jobs.

Reason:

- those jobs only wrapped fixed shell commands
- the wrapper burned OpenAI/OpenClaw tokens before launching Python that could already run directly

Tracked source of truth now lives in the ingest skill repo:

- runners: `~/.openclaw/workspace/integrations/wa-greenapi-ingest-skill/scripts/runners/`
- systemd templates: `~/.openclaw/workspace/integrations/wa-greenapi-ingest-skill/ops/systemd/`
- install helper: `~/.openclaw/workspace/integrations/wa-greenapi-ingest-skill/ops/systemd/install-wa-greenapi-timers.sh`

Live timers on the VM:

- `wa-greenapi-ingest-queue.timer`
- `wa-greenapi-history-reconcile.timer`
- `wa-greenapi-embeddings-backfill.timer`
- `wa-greenapi-enrich-media.timer`

Operational rule:

- do not recreate these jobs as OpenClaw `cron` agent turns
- if cadence or command flags must change, edit the tracked runner or timer templates in the skill repo and redeploy them with the installer
- direct API usage inside the Python jobs is still expected:
  - `scripts/embed_missing.py` calls OpenAI embeddings
  - `scripts/greenapi_ingest.py` may call OpenAI transcription during enrich runs
- the rendered services also import `/etc/openclaw/openclaw.env` so they can reuse the same non-skill environment as `openclaw.service` when that file contains provider credentials

Minimum verification set after any change:

```bash
systemctl list-timers 'wa-greenapi-*'
systemctl status wa-greenapi-ingest-queue.timer --no-pager
journalctl -u wa-greenapi-enrich-media.service -n 100 --no-pager
openclaw cron list
```

Expected result:

- the four `wa-greenapi-*` timers are active
- the old WhatsApp archive OpenClaw cron jobs are absent or disabled

Audio transcription fallback as of `2026-04-18`:

- direct `OPENAI_API_KEY` is still not required for WhatsApp audio enrich correctness because the skill fallback chain is now:
  `GREENAPI_TRANSCRIBE_MODEL` -> `whisper-1` -> local whisper -> `openclaw capability audio transcribe`
- the host now also carries direct provider credentials in `/etc/openclaw/openclaw.env` for embeddings and semantic search, but audio must keep working even if that direct OpenAI path is unavailable
- the final OpenClaw fallback reuses the live host `tools.media.audio` config instead of moving the jobs back into OpenClaw cron
- WhatsApp voice files stored as `.oga` are normalized to `.ogg` before provider transcription, because the provider audio endpoints accept Ogg/Opus content but reject the `.oga` filename extension
- the live rm.loc `tools.media.audio` order currently resolves to:
  `groq/whisper-large-v3-turbo` -> `openai/gpt-4o-mini-transcribe`
- treat direct OpenAI key absence as a cost/latency preference issue, not as a scheduler regression

## 2026-04-18 WhatsApp audio service fix

Observed regression on `2026-04-18`:

- manual `greenapi_ingest.py ingest-once --source history --max-events 8` runs transcribed the latest WhatsApp voice notes successfully
- the systemd `wa-greenapi-enrich-media.service` path kept failing the same files and previously could downgrade a good archive row back to `transcript_unavailable`

Validated root causes:

- the skill upsert path allowed a later failed audio retry to overwrite an already successful `[audio transcript] ...` row for the same `source_message_id`
- the rendered `wa-greenapi-*` systemd services used the wrong host layout:
  - wrong: `OPENCLAW_HOME=/home/openclaw/.openclaw`
  - correct: `OPENCLAW_HOME=/home/openclaw`
  - correct: `OPENCLAW_STATE_DIR=/home/openclaw/.openclaw`
- that wrong `OPENCLAW_HOME` broke the final fallback path that shells out to `openclaw capability audio transcribe`

Tracked fixes now live in the external skill repo:

- successful audio transcripts are preserved if a later retry fails
- `wa_enrich_media_docs_audio.sh` defaults to `WA_GREENAPI_ENRICH_MAX_EVENTS=8`
- all three tracked systemd service templates now use the host OpenClaw home/state split above

Validated live state after redeploy on `2026-04-18`:

- `wa-greenapi-enrich-media.service` completed with:
  - `received=8`
  - `updated=5`
  - `transcribed=5`
- Danil test voice row at `ts=2026-04-18T10:54:08+00:00` in `/home/openclaw/.openclaw/workspace/wa_archive.db` now stores:
  - text: `[audio transcript] Голосовое сообщение для Данила 123.`
  - `transcription.ok=true`
  - `engine=openclaw:capability-audio`

Operational rule:

- if WhatsApp audio enrich ever diverges again between manual runs and systemd runs, compare `OPENCLAW_HOME` and `OPENCLAW_STATE_DIR` first before debugging GreenAPI or STT providers

## 2026-04-18 WhatsApp embeddings and semantic search fix

Observed regression on `2026-04-18`:

- `wa-greenapi-embeddings-backfill.service` was failing on rm.loc before it could finish the latest WhatsApp archive rows
- the first failure mode was missing direct provider credentials
- after restoring credentials, the next failure mode was `sqlite3.OperationalError: database is locked`

Validated root causes:

- `/etc/openclaw/openclaw.env` did not contain `OPENAI_API_KEY`, so `embed_missing.py` could not call the embeddings endpoint
- `openclaw.service.d/30-canonical-state.conf` had reset `EnvironmentFile=`, so the running OpenClaw gateway no longer inherited `/etc/openclaw/openclaw.env`
- `scripts/embed_missing.py` held a long-lived SQLite write transaction across provider round-trips, which made it collide with live ingest/enrich writers on the same archive DB

Tracked fixes:

- `/etc/openclaw/openclaw.env` now carries the direct provider credentials needed by the embeddings backfill job
- `openclaw.service.d/50-provider-env.conf` restores `EnvironmentFile=/etc/openclaw/openclaw.env` for the live gateway process
- the external `wa-greenapi-ingest-skill` repo now commits each embedding row immediately and honors `WA_EMBED_SQLITE_BUSY_TIMEOUT_MS`, so backfill does not hold the SQLite write lock while it waits on the provider for the next row

Validated live state after redeploy on `2026-04-18`:

- gateway process env now includes the provider key and `openclaw.service` is listening again on `127.0.0.1:18789`
- `/home/openclaw/.openclaw/workspace/wa_archive.db` now reports:
  - `messages_total=5668`
  - `embeddings_total=5668`
  - `missing_embedding_candidates=0`
- `wa-memory-search` semantic lookup is healthy against the same live archive:
  - query `царь три сына` returns row `5720` with Yuri Yakovenko's fresh voice transcript
  - query `голосовое сообщение для Данила 1 2 3` returns row `5718` with the Danil test voice transcript

Operational rule:

- `wa-greenapi-ingest-skill` and `wa-memory-search` remain separate repos with separate responsibilities
- ingest owns normalization and writes into `/home/openclaw/.openclaw/workspace/wa_archive.db`
- search owns lookup and semantic retrieval against that same DB
- if semantic search breaks again, check both the shared archive DB counts and whether `openclaw.service` still imports `/etc/openclaw/openclaw.env`

## 2026-04-18 WhatsApp full-history reconcile fix

Observed regression on `2026-04-18`:

- the live rm.loc scheduler only ran queue ingest, enrich, and embeddings timers
- queue ingest only sees fresh GREEN-API notifications after the timer starts; it does not backfill older chats automatically
- chat `77085803915@c.us` existed in GREEN-API and `getChatHistory(...)`, but had zero rows in `/home/openclaw/.openclaw/workspace/wa_archive.db`

Validated root causes:

- `wa-greenapi-ingest-queue.timer` had only been active since `2026-04-18 09:31 UTC`, while the missing chat's latest messages were from `2026-04-15 08:27 UTC` to `2026-04-15 08:33 UTC`
- there was no periodic systemd job running `ingest-full-history` against the full WhatsApp chat universe
- the tracked `ingest_full_history_once(...)` logic was also truncating refreshed discovery to the current `max_chats` processing slice, so even a future timer would have learned only the first `N` chats instead of all discovered chats

Tracked fixes:

- the external `wa-greenapi-ingest-skill` repo now keeps the full refreshed `chat_order` in state and reports coverage counters:
  - `db_known_chats_before/after`
  - `chat_order_total`
  - `completed_chats_total`
  - `remaining_chats_total`
  - `coverage_missing_chats_before/after`
- the skill repo now ships `scripts/runners/wa_history_reconcile.sh`
- rm.loc now has `wa-greenapi-history-reconcile.service` + `wa-greenapi-history-reconcile.timer`
- the reconcile runner refreshes the full chat list on each run, then processes a bounded slice without truncating discovery itself

Validated live state after redeploy on `2026-04-18`:

- `systemctl status wa-greenapi-history-reconcile.timer` is now `active (waiting)`
- the live state file is `/home/openclaw/.openclaw/workspace/.greenapi_ingest_state.json`
- a manual reconcile pass on rm.loc completed with:
  - `inserted=143`
  - `chats_processed=48`
  - `db_known_chats_before=613`
  - `db_known_chats_after=618`
  - `chat_order_total=1917`
  - `coverage_missing_chats_before=1304`
  - `coverage_missing_chats_after=1299`
- chat `77085803915@c.us` now has `54` rows in the live archive
- the latest imported rows for that peer now include:
  - `2026-04-15T08:33:24+00:00` inbound `👌`
  - `2026-04-15T08:30:42+00:00` outbound `Спасибо, как подпишут скину Вам`
  - `2026-04-15T08:30:18+00:00` inbound `Данные в авр достаточно 👍`
- after two explicit embeddings backfill passes following that history import:
  - `missing_embeddings=0`
  - `peer_missing_embeddings=0`

Operational rule:

- `wa-greenapi-ingest-queue.timer` by itself is not enough to guarantee WhatsApp archive completeness
- keep `wa-greenapi-history-reconcile.timer` enabled if the requirement is “all chats eventually land in the local archive automatically”
- when validating coverage, check the live state file and the reconcile JSON counters, not only queue timer health

## 2026-04-16 Obsidian journal sync note

The rm.loc deployment now keeps the private Obsidian vault on the VM through Obsidian Headless Sync.

Live components:

- synced vault path: `/home/openclaw/.openclaw/workspace/obsidian-vaults/my_obsidian`
- continuous sync service: `obsidian-headless-sync.service`
- journal skill repo: `~/.openclaw/workspace/skills/obsidian-journal`

Validated live state on `2026-04-16`:

- `ob sync-setup --vault my_obsidian` completed successfully against the remote Obsidian Sync vault
- initial full download completed and included `Ежедневник`
- `obsidian-headless-sync.service` was enabled in systemd and reached `active (running)`
- the synced vault contains the expected daily-note tree under `Ежедневник`

Operational rule:

- the VM must use the synced Linux vault path, not the Windows path `D:\Obsidian\my_obsidian`
- if journal writes stop working, first check `systemctl status obsidian-headless-sync.service`
- only if the sync service is healthy should you debug the skill logic itself
