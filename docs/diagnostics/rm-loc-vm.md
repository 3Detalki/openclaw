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

- the three `wa-greenapi-*` timers are active
- the old WhatsApp archive OpenClaw cron jobs are absent or disabled

Known direct-API gap as of `2026-04-18`:

- `OPENAI_API_KEY` is not currently present in the skill `.env`, in `/etc/openclaw/openclaw.env`, or in the live `openclaw.service` process environment
- because of that, the scheduler migration is successful, but `wa-greenapi-enrich-media.service` still logs transcription warnings such as `OPENAI_API_KEY is not set`
- treat that as a separate provider-credentials task, not as a reason to move these jobs back into OpenClaw cron

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
