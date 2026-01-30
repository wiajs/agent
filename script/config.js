/* eslint-disable import/no-extraneous-dependencies */
import commonjs from '@rollup/plugin-commonjs' // CommonJS 模块转换成 ES6
import resolve from '@rollup/plugin-node-resolve' // 导入node_modules 中的 CommonJS 模块
import replace from '@rollup/plugin-replace' // 替换待打包文件里的一些变量，如 process在浏览器端是不存在的，需要被替换
import swc from '@rollup/plugin-swc' // 编译转换ES6语法
import {builtinModules} from 'module' // node 内部库
import path from 'path'
import {fileURLToPath} from 'url'

import {getJsOpt} from './swc.js'

import pkg from '../package.json' with {type: 'json'}

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const version = process.env.VERSION || pkg.version
const name = 'Agent' // umd 模式下的全局变量名

const banner = `/*!
  * wia agent v${version}
  * (c) 2024-${new Date().getFullYear()} Sibyl Yu and contributors
  * Released under the MIT License.
  */`

const env = process.env.NODE_ENV || 'development'
const isDev = env !== 'production'

const dir = _path => path.resolve(__dirname, '../', _path)

const input = dir('./src/index.js')

/**
 * 从 package.json 和 builtinModules 中获取不打包的引用库
 * 生成 node cjs 库时需要
 * umd 全部打包，不需要
 */
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.devdependencies || {}),
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  /@babel\/runtime/, // babel helpers  @babel/runtime-corejs3/
]

/**
 * 仅支持node，不支持browser
 * 仅生成cjs，esm直接引用代码，代码为 esm格式
 */
const configs = [
  {
    input,
    file: dir('dist/agent.cjs'), // cjs格式，后端打包，保留引用
    format: 'cjs',
    exports: 'named', // named 以独立名称输出各子模块, default 整体输出，混合输出时__esModule为true
    browser: false, // 不支持浏览器
    external,
    es6: true, // swc 转换代码到 es2015，避免node版本过低代码不兼容
  },
].map(genConfig)

/**
 * 输出配置文件，只支持input 和 output，其他如 plugins、external 无效
 * plugins、external 需放入 input
 * @param {*} param0
 * @returns
 */
function genConfig({input, browser = true, es6 = true, ...cfg}) {
  const config = {
    input: {
      input,
      external: cfg.external, // 外部变量，不打入包中
      // 插件，从上向下顺序执行
      plugins: [
        // node_modules 中超ES6已转换为ES6
        resolve({browser}), // 从 node_modules 合并文件，pkg的browser文件替换 mainFields: ['browser']
        // 替换特定字符串
        replace({
          preventAssignment: true, // 避免赋值替换  xxx = false -> false = false
          'process.env.NODE_ENV': JSON.stringify(env),
          'process.env.NODE_TEST': JSON.stringify('false'),
          'process.browser': !!browser,
          __VERSION__: version,
        }),
        // 根据需要，将es6 转换为 es5，兼容所有浏览器，依赖@babel/runtime-corejs3 polyfill
        es6 && swc({swc: getJsOpt(false, false)}),
        // 最后再把三方 CJS 转成 ESM 给 Rollup
        commonjs(), // common 转换为 es6，rollup 只支持 es6
      ],
    },
    output: {
      file: cfg.file,
      format: cfg.format,
      sourcemap: isDev,
      banner,
      // name: '$$', // $ 会覆盖 window.$
      name: cfg.name ?? undefined,
      exports: cfg.exports ?? 'auto',
      globals: {}, // 全局变量
      generatedCode: {
        constBindings: cfg.format !== 'umd', // var -> const
      },
    },
  }

  return config
}

export default configs
