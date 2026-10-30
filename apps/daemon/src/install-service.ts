import { resolvePaths } from './paths.ts'
import { openService } from './cli/service/index.ts'

openService(resolvePaths()).install(true)
