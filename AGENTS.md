## RTK / Shell commands

For shell and development commands, prefer RTK-wrapped commands when useful.

Use:
- `rtk git status`
- `rtk git diff`
- `rtk rg "..."`
- `rtk npm test`, `rtk pnpm test`, `rtk pytest`, `rtk cargo test`
- `rtk docker ps`, `rtk docker logs ...`, `rtk kubectl ...`

Use raw commands only when exact unfiltered output is required or when RTK does not support the command. Prefer targeted `rtk rg`, `rtk read`, `rtk git diff`, and `rtk vitest run` over broad raw `Read`/`Glob` calls; avoid those unless exact file contents are required.

Keep responses concise unless detail is explicitly requested.
