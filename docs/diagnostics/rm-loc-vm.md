---
summary: "Operational note for the rm.loc OpenClaw VM deployment."
read_when:
  - Maintaining the rm.loc OpenClaw deployment
  - Verifying the live VM after upgrade, rollback, or reboot
title: "rm.loc VM"
---

# rm.loc VM

This repository is the source of truth for the `openclaw.rm.loc` deployment.

Target live state as of `2026-03-12`:

- Public entrypoint: `https://openclaw.rm.loc/`
- Runtime host: VM `openclaw-secure`
- Gateway service: `openclaw.service`
- Installed package: `openclaw@2026.3.8`
- Bind address: `127.0.0.1:18789`
- Active state dir: `/home/openclaw/.openclaw`
- WhatsApp channel: builtin bridge only
- Telegram channel: builtin bridge only

## Service invariants

The live VM is considered correct only if all of the following stay true:

- `openclaw.service` runs from systemd, not from an ad hoc shell session.
- `OPENCLAW_HOME=/home/openclaw`
- `OPENCLAW_STATE_DIR=/home/openclaw/.openclaw`
- The Gateway binds to loopback on port `18789`.
- `plugins.load.paths` is empty in live config unless a tracked repo change says otherwise.
- Builtin `whatsapp` stays enabled. No local WhatsApp fork overlay should be loaded in production.

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

- `openclaw --version` prints `2026.3.8`
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

If the external page shows `Health Offline` while the local checks above pass, treat it as a UI auth or pairing problem first, not as a service outage.
