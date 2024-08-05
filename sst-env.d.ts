/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    "DbPass": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "DbUser": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "HmacKey": {
      "type": "sst.sst.Secret"
      "value": string
    }
  }
}
export {}
