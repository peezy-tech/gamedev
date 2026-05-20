import { AssetsS3 } from './AssetsS3'
import { AssetsLocal } from './AssetsLocal'
import { AssetsAssetService } from './AssetsAssetService'

export const assets = process.env.ASSETS === 's3'
  ? new AssetsS3()
  : process.env.ASSETS === 'asset-service'
    ? new AssetsAssetService()
    : new AssetsLocal()
