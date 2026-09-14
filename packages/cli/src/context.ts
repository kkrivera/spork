import { REGISTRY_PATH, REPOS_ROOT } from '@spork/core'
import { createUi, type Ui, type UiOptions } from './output/color.js'

export interface CoreContext {
  reposRoot: string
  registryPath: string
}

export interface AppContext extends CoreContext {
  ui: Ui
}

export function createAppContext(uiOptions?: UiOptions): AppContext {
  return {
    reposRoot: REPOS_ROOT,
    registryPath: REGISTRY_PATH,
    ui: createUi(uiOptions),
  }
}
