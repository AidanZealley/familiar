import { resolvePaths } from './paths.ts'
import { openService } from './service/index.ts'

openService(resolvePaths()).install(true)
