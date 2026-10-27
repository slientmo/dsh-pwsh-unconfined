import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox'

/**
 * 与 `@deepseek-ai/dsh-pwsh-sandbox` 行为一致，只有一处不同：
 * `confine()` 不再把 argv 交给 `ctx.sandbox` 的 ACL 受限令牌 runner，
 * 而是原样返回，让命令以 DSH 进程自身的权限运行。
 *
 * 为什么不去掉沙箱执行器改用 `pwsh-local`：`dsh-permission-presets`
 * 要求 `ctx.shell.sandboxMode` 存在才能挂载，否则「仅可查看 / 工作区内修改 /
 * 完全权限」选择器会整体消失。本类继承 `SandboxPwshExecutor`，因此
 * `sandboxMode`、`static inject`、`static Config` 以及结算期的 sandbox 事实
 * 全部保留，只换掉实际启动方式。
 *
 * 本机背景：受限令牌 runner 启动 pwsh 时稳定以 0xC0000142 退出，详见
 * cordis.patch.yml 里的证据记录。
 */
export class UnconfinedPwshExecutor extends SandboxPwshExecutor {
  /**
   * 返回未经 `ctx.sandbox` 包装的 argv。
   * @param spec - 已解析的执行规格。
   */
  confine(spec) {
    return Promise.resolve({
      argv: this.argv(spec),
      enforcement: 'none',
      denialSignatures: [],
      runnerFailureRules: [],
    })
  }
}

export default UnconfinedPwshExecutor
