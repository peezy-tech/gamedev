import { AssetsS3 } from './AssetsS3.js'
import { AssetsLocal } from './AssetsLocal.js'

export const assets = process.env.ASSETS === 's3' ? new AssetsS3() : new AssetsLocal()
