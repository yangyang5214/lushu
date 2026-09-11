// `pnpm dev` / `pnpm pages:dev` 启动前跑一下：
// 如果还没有 .env，就从 .env.example 复制一份。
// 这样 `--env-file=.env` 不会因为文件不存在而报错，新人 clone 下来也能直接跑。
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = resolve(root, '.env')
const example = resolve(root, '.env.example')

if (!existsSync(env) && existsSync(example)) {
  copyFileSync(example, env)
  console.log('[lushu] 已从 .env.example 生成 .env（已被 gitignore）')
}
