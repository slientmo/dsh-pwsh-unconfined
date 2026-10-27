# dsh-pwsh-unconfined

[English](README.md) | **简体中文**

一个 DeepSeek Harness（DSH）插件：在 Windows 上，当 ACL 受限令牌沙箱 runner
无法启动 PowerShell 时，让 `pwsh` 工具继续可用。

---

## 问题

Windows 上 DSH 会把 `@deepseek-ai/dsh-pwsh-sandbox` 挂成 `ctx.shell`，每条命令都经
Windows ACL 受限令牌 runner 启动，从而把 `workspace-write` 会话限制在工作区内。

在某些机器上，该 runner 在早期 DLL 初始化阶段就失败，子进程结算为：

```
[exit code: 3221225794]      # 0xC0000142 = STATUS_DLL_INIT_FAILED
（完全没有输出）
```

无论工作目录是什么、无论配置哪个 `pwsh.exe`，每条命令都以这种方式失败。结果是
`pwsh` 工具彻底不可用，而文件策略明明只是 `workspace-write`，同时文件工具一切正常。

在编写本插件的机器上，以下原因已被逐一排除：

| 怀疑对象 | 结论 |
|---|---|
| PowerShell 缺失或损坏 | 排除——`pwsh.exe` 在沙箱之外运行正常 |
| 解压 zip 带来的"来自网络"标记 | 真实问题：模块加载报 `AuthorizationManager check failed`；清除 571 个 `Zone.Identifier` 后该问题消失，**但 `0xC0000142` 依旧** |
| 工作区 DACL | 排除——随包的 `diagnose-windows-sandbox-acl` 报告 `VERDICT=NOT_THIS_CLASS`（WRITE_DAC/WRITE_OWNER 均具备，无外来应用包授权项） |
| 工作目录 | 排除——任何目录下表现一致 |

剩下的就是受限令牌 runner 这一层，它位于原生代码中，插件无法修补。

## 本插件做了什么

它**保留**沙箱执行器类（因此 `ctx.shell.sandboxMode` 仍存在，权限选择器不会消失），
只替换"进程如何启动"：

```js
export class UnconfinedPwshExecutor extends SandboxPwshExecutor {
  confine(spec) {
    return Promise.resolve({
      argv: this.argv(spec),   // 不包装：不经受限令牌 runner
      enforcement: 'none',
      denialSignatures: [],
      runnerFailureRules: [],
    })
  }
}
```

服务注册是继承自带的：基类 `ShellExecutor` 在构造函数里调用 `super(ctx, "shell")`，
继承它即接管 `ctx.shell`。

## 代价（安装前必读）

- **Shell 命令不再受 ACL 受限令牌约束**，以 DSH 进程自身权限运行；
- **文件工具仍由 `fs-sandbox` 单独围栏**，`workspace-write` 对 `ctx.fs` 的写入限制照旧生效
  （已实测：工作区内写入成功，工作区外被拒）；
- 命令结果会如实报告 `sandbox.enforcement: none`，不会假装已隔离；
- 这是**绕过方案**，不是修复。上游 runner 修好后请停用本插件以恢复真正的隔离。

## 环境要求

- Windows
- DSH `>= 0.2.1-rc.3`
- 可用的 `pwsh.exe`（推荐 PowerShell 7）

## 安装

1. 把包复制进 profile 的 `node_modules`：

   ```powershell
   Copy-Item -Recurse . "$env:DSH_HOME\profiles\desktop\node_modules\dsh-pwsh-unconfined"
   ```

2. 加入 profile 的 bundle 列表，编辑 `profiles/desktop/package.json`：

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

3. 在插件的 `cordis.patch.yml` 里把 `pwshPath` 指向你的解释器：

   ```yaml
   - insert:
       - id: pwsh-sandbox-unconfined
         name: dsh-pwsh-unconfined
         config:
           pwshPath: 'D:\PowerShell-7.6.9-win-x64\pwsh.exe'
   ```

4. **完全重启 DSH。** Loader 配置在启动时装配，关窗口不算，要结束进程。

## 验证

把会话切到「工作区内修改」（`workspace-write`），执行：

```powershell
$PSVersionTable.PSVersion.ToString(); (Get-Location).Path
```

预期返回版本号与工作目录，且没有 `0xC0000142`。

## 卸载

从 `dsh.profile.bundles` 里删掉 `"dsh-pwsh-unconfined"`（注意逗号），重启即可，
原来的 `pwsh-sandbox` 行会重新生效。

## 兼容性说明

本插件子类化了 `SandboxPwshExecutor`，依赖其 `confine(spec, policy, signal)` 契约。
若 DSH 升级改动了沙箱执行器内部，插件可能加载失败——届时 `ctx.shell` 缺失，
权限选择器也会一起消失。恢复方式：删掉 bundle 条目并重启。

## 作者

[slientmo](https://github.com/slientmo)

## 许可证

MIT，见 [LICENSE](LICENSE)。
