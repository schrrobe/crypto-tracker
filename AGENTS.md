## RTK / Shell commands

For shell and development commands, prefer RTK-wrapped commands when useful.

Use:
- `rtk git status`
- `rtk git diff`
- `rtk rg "..."`
- `rtk npm test`, `rtk pnpm test`, `rtk pytest`, `rtk cargo test`
- `rtk docker ps`, `rtk docker logs ...`, `rtk kubectl ...`

Use raw commands only when exact unfiltered output is required or when RTK does not support the command.
