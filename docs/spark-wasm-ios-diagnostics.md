# Spark wasm on iOS WeChat — 根因与自建构建

## 症状

iOS 微信里打开含 `.rad` 资产的场景时，日志形如：

```
[SparkWasm][instantiate] {"strategy":"wx-instantiate-path","path":"pages/spark/spark_rs_bg.wasm","ok":false,...,"callMs":16,"settleMs":176212,"error":{"message":"CompileError: invalid wasm file"}}
[SparkWasm][bootstrap] {"stage":"failed",...}
[SparkRuntime][rad-failed] {... "wasmInitFailed":true ...}
```

`.rad` 的报错是**后果**：Spark 的 wasm 没编译成功，rad 一个字节都没开始解析。

## 根因（2026-10-08 真机定论）

微信 iOS 的 `WXWebAssembly`（实测 8.0.78 / iOS 15.8.4 / iPhone 6s Plus）只实现了 reference-types 的**表格**部分，没有实现**值**部分，也不支持多表：

| 构造 | 探针 | 结果 |
| --- | --- | --- |
| 两张表（funcref + externref） | `multi-table` | ❌ `CompileError: invalid wasm file` |
| externref 出现在函数签名 | `externref-signature` | ❌ 同上 |
| 单张 externref 表 / 表导出 / active element 段 / datacount 段 | `reference-types` / `table-export` / `element-active` / `datacount-active` | ✅ |
| 被动 data 段 + `memory.init` | `memory-init` | ❌ |
| SIMD / multivalue / sign-ext / nontrapping / 可变 global 导出 / memory.copy | 对应探针 | ✅ |

官方 Spark 产物（npm 2.3.0/2.3.1）用到前两项（54 个 externref 值槽、funcref + externref 两张表），因此在 iOS 微信上必然失败；失败发生得很晚（实测调用 16ms 返回、promise 176s 后才报错，第二次 118ms 命中缓存），所以代价是每次启动白等几分钟。

## 修复：自建构建（关闭 reference-types）

- 源码：上游 MIT 仓库 `sparkjsdev/spark`，tag `v2.3.0`（`cce78e2cf5505679abbaf64236e0834de385010c`）
- 落地：`vendor/sparkjsdev-spark-2.3.0-mp.tgz`，`schema/package.json` 依赖改为 `file:../vendor/sparkjsdev-spark-2.3.0-mp.tgz`（包内版本仍为 2.3.0）
- 产物指纹：
  - `vendor/sparkjsdev-spark-2.3.0-mp.tgz` = `2b40f7326fe447d6afccca8dcf5c8688268117f59c285138a4f23ba07723beb1`
  - 包内 `dist/spark.module.js` = `acb07be133135d70bcad05cf92727db82bad56ed02c15a666cc3802cb6ac1418`
  - 发货的 `pages/spark/spark_rs_bg.wasm` = `a0342671e618f95173acd314661dd4cf42d2c597d3bc9604c7a5cf33f7cfff9f`（1519.2 KiB，比厂商版更小）
- 结果：externref 值槽 0、1 张 funcref 表、`target_features` 无 `+reference-types`、element/data 段都是 MVP 编码，其余特性（simd128 / bulk-memory / multivalue / sign-ext / nontrapping / mutable-globals）保持不变。

## 重新生成步骤（升级 Spark 或重建时照做）

```powershell
git clone --depth 1 --branch v2.3.0 https://github.com/sparkjsdev/spark.git   # 仓库外临时目录
```

1. 关特性：把 `rust/.cargo/config.toml` 与 `rust/build_rust_wasm.ps1` 里的 rustflags 改成 `-C target-feature=+simd128,+bulk-memory,-reference-types`。
2. 编译：`cargo install wasm-pack` → `npm install` → `npm run build:wasm`。
   - 用 wasm-bindgen CLI 兜底时（`cargo install wasm-bindgen-cli --version 0.2.117`）要带 `--target web --typescript --omit-default-module-path`，输出 wasm 命名成 `spark_rs_bg.wasm`，并手工补 wasm-pack 才会生成的 `rust/spark-rs/pkg/package.json`（`name: spark-rs`、`main/module: spark_rs.js`），否则 vite 解析不了裸包名 `spark-rs`。
3. **删掉 std 带进来的过时声明**：wasm-ld 会把预编译 std 的 `+reference-types` 合并进最终模块，而 wasm-bindgen 正是据此决定启用 externref（不删就会报 `failed to find the __wbindgen_externref_table_alloc function`）。做法是解析 `target_features` 自定义段（内容是 `vec(prefix, name)`，prefix 为 `+`/`-`），去掉 `(+ , reference-types)` 后重写计数与段长度。
4. 优化体积：`npm i binaryen` 后用其 `wasm-opt -O`（1848.6 KiB → 1519.2 KiB）。
5. 出 dist：`npm run build:production && npm run build:dev`（production 那趟会清空 `dist/`，dev 那趟产出未压缩的 `dist/spark.module.js`）。
6. 打包：以原 npm 包为基础替换 `dist/` 下 8 个 JS/map 文件，`npm pack --ignore-scripts`，改名 `sparkjsdev-spark-2.3.0-mp.tgz` 放到 `vendor/`，把 sha256 写进 `vendor/sparkjsdev-spark-2.3.0-mp.sha256`。
7. 在 `schema`、`viewer`、`tour` 各跑一次 `pnpm install`，确认三处 `dist/spark.module.js` 的 sha256 都等于上面的值（只有 `schema` 声明该依赖，另外两个经 `file:../schema` 间接安装）。

## 门禁与回归测试

- 编译前能力门禁保留，但列表现在是空的（`SPARK_WASM_PREFLIGHT_FEATURES = []`）：新产物不再需要那些构造，不能把 iOS 这种本来能跑的运行时短路掉。
- 它同时是**触发式陷阱**：将来升级 Spark 若又带回这些构造，把对应特性填回去即可让老设备毫秒级判死，而不是白等几分钟。
- `tools/src/vite/sparkWasmPageBootstrap.test.ts` 会直接解析**实际发货**的那份 wasm，断言「externref 值槽 0、1 张表、无 `+reference-types`、门禁列表 ⊆ 产物真实用到的构造」，防止升级时悄悄退回去。

## 真机验收

期望看到：`[SparkWasm][bootstrap]` 先出 `"stage":"preflight","ok":true`（列表为空，只跑 mvp 控制），随后 `"stage":"ready"`；再出现 `[SparkRuntime][rad-ready]` 才算真正跑通。请记录 `stage:"ready"` 的 `ms`——这台 2015 年的设备首次编译 1.6MB wasm 可能仍需数十秒。

调试开关（默认关，按需叠加后再构建）：

```powershell
$env:HARMONY_SPARK_WASM_SIZE_PROBE='1'; pnpm run build:mp-weixin   # 体积探针（本例已证明与体积无关）
$env:HARMONY_SPARK_WASM_BROTLI='1'; pnpm run build:mp-weixin       # 产出 .wasm.br（纯余量优化）
```

## 残余风险

- 首次编译耗时未测（本次失败的一趟花了 176s）。
- 自建产物不等于官方发布：升级 Spark 必须重跑上面 7 步，并让第 7 步的哈希校验通过。
- 交叉验证：同一构建在 Android / 新机型上跑一次 `featureProbe`，确认没弄坏原本可用的平台。
- `pages/spark` 已从 1914.8KiB 降到 1804.8KiB（接近 2MiB 上限的压力仍在，必要时用 brotli 开关）。
