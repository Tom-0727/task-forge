---
name: mailbox-operate
description: Operate the mailbox system with three commands -> mailbox-send for sending messages, mailbox-read for reading messages, and mailbox-contacts for listing contacts.
---

# mailbox-operate

Use this skill for all mailbox operations. It provides three commands:

- `mailbox-send`: send a message to human or another agent
- `mailbox-read`: read messages from a specific contact or get unread summary
- `mailbox-contacts`: list all contacts

## Before first use

Read `mailbox/README.md`.

## mailbox-send

Send to human (default):

```bash
uv run python {skills-dir}/mailbox-operate/scripts/send_mailbox.py --kind update --message "Implemented the first pass."
```

Send to another agent:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/send_mailbox.py --to jarvis --message "Need your analysis results."
```

Broadcast to all agent contacts:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/send_mailbox.py --broadcast --message "Phase 1 complete."
```

Need a reply and pause:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/send_mailbox.py --to human --kind decision --await-reply --message "Need decision: keep Claude support or remove it."
```

Multi-line from stdin:

```bash
cat /tmp/message.txt | uv run python {skills-dir}/mailbox-operate/scripts/send_mailbox.py --kind blocker --await-reply
```

## mailbox-read

Read unread human messages (default):

```bash
uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py
```

Read unread messages from a specific agent:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --from jarvis
```

Read latest N messages from a contact:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --from jarvis 5
```

Get unread summary across all contacts:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/read_mailbox.py --summary
```

## mailbox-contacts

List all contacts:

```bash
uv run python {skills-dir}/mailbox-operate/scripts/contacts.py
```

## Rules

- Prefer skill scripts over manual JSONL edits.
- Keep messages concise and decision-oriented.
- Use `--await-reply` only when you truly need to pause until a reply arrives.
- `--broadcast` and `--await-reply` cannot be used together.
- Contacts are managed by human via the platform frontend; do not attempt to create or remove contacts.
