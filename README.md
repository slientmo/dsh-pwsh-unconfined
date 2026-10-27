# dsh-pwsh-unconfined

**English** | [简体中文](README.zh.md)

A DeepSeek Harness (DSH) plugin that keeps the `pwsh` tool usable on Windows when
the ACL restricted-token sandbox runner fails to start PowerShell.

---

## The problem

On Windows, DSH mounts `@deepseek-ai/dsh-pwsh-sandbox` as `ctx.shell`. Every
command is spawned through a Windows ACL restricted-token runner so that
`workspace-write` sessions are confined to the workspace.

On some machines that runner dies during early DLL initialization, and the child
settles as:

```
[exit code: 3221225794]      # 0xC0000142 = STATUS_DLL_INIT_FAILED
(no output at all)
```

Every command fails this way — regardless of working directory, regardless of
which `pwsh.exe` is configured. The `pwsh` tool becomes completely unusable even
though the file policy is only `workspace-write`, and file tools keep working
normally.

Things that were ruled out on the machine this plugin was written for:

| Candidate cause | Finding |
|---|---|
| Missing / broken PowerShell | ruled out — `pwsh.exe` runs fine outside the sandbox |
| Mark-of-the-Web on the extracted zip | real issue, PowerShell module loading failed with `AuthorizationManager check failed`; clearing 571 `Zone.Identifier` streams fixed that **but not** `0xC0000142` |
| Workspace DACL | ruled out — the bundled `diagnose-windows-sandbox-acl` script reports `VERDICT=NOT_THIS_CLASS` (WRITE_DAC/WRITE_OWNER present, no foreign package allow ACEs) |
| Working directory | ruled out — fails identically in any directory |

The remaining layer is the restricted-token runner itself, which lives in native
code and cannot be patched from a plugin.

## What this plugin does

It keeps the sandbox executor class — so `ctx.shell.sandboxMode` still exists and
the permission selector keeps working — and only replaces *how the process is
started*:

```js
export class UnconfinedPwshExecutor extends SandboxPwshExecutor {
  confine(spec) {
    return Promise.resolve({
      argv: this.argv(spec),   // unwrapped: no restricted-token runner
      enforcement: 'none',
      denialSignatures: [],
      runnerFailureRules: [],
    })
  }
}
```

Service registration comes for free: the base `ShellExecutor` calls
`super(ctx, "shell")` in its constructor, so subclassing it takes over
`ctx.shell`.

## Trade-offs — read before installing

- **Shell commands are no longer confined by the ACL restricted token.** They run
  with the DSH process's own authority.
- **File tools remain fenced separately** by `fs-sandbox`, so `workspace-write`
  still constrains `ctx.fs` writes (verified: writes inside the workspace
  succeed, writes outside are denied).
- Command results report `sandbox.enforcement: none` — the plugin does not
  pretend the command was isolated.
- This is a **workaround**, not a fix. When the upstream runner is repaired,
  disable this plugin to get real confinement back.

## Requirements

- Windows
- DSH `>= 0.2.1-rc.3`
- A working `pwsh.exe` — PowerShell 7 recommended

## Install

1. Copy the package into the profile's `node_modules`:

   ```powershell
   Copy-Item -Recurse . "$env:DSH_HOME\profiles\desktop\node_modules\dsh-pwsh-unconfined"
   ```

2. Add it to the profile's bundle list — edit
   `profiles/desktop/package.json`:

   ```json
   {
     "dsh": {
       "profile": {
         "bundles": [
           "...",
           "dsh-pwsh-unconfined"
         ]
       }
     }
   }
   ```

3. Point `pwshPath` at your interpreter in the plugin's `cordis.patch.yml`:

   ```yaml
   - insert:
       - id: pwsh-sandbox-unconfined
         name: dsh-pwsh-unconfined
         config:
           pwshPath: 'D:\PowerShell-7.6.9-win-x64\pwsh.exe'
   ```

4. **Fully restart DSH.** Loader configuration is assembled at startup; a window
   close is not enough — end the process.

## Verify

With the session set to **Work in workspace** (`workspace-write`), run:

```powershell
$PSVersionTable.PSVersion.ToString(); (Get-Location).Path
```

Expected: the version and the working directory, no `0xC0000142`.

## Uninstall

Remove `"dsh-pwsh-unconfined"` from `dsh.profile.bundles` (mind the trailing
comma) and restart. The original `pwsh-sandbox` row becomes active again.

## Compatibility note

The plugin subclasses `SandboxPwshExecutor`, so it depends on that class's
`confine(spec, policy, signal)` contract. If a DSH upgrade changes the sandbox
executor's internals, the plugin may fail to load — in which case `ctx.shell`
would be missing and the permission selector would disappear too. To recover:
remove the bundle entry and restart.

## Author

[slientmo](https://github.com/slientmo)

## License

MIT — see [LICENSE](LICENSE).
