// SPDX-License-Identifier: Apache-2.0

/* 
This code was written by Zac Delventhal @delventhalz.
Original source code can be found here: https://github.com/delventhalz/transfer-chain-js/blob/master/processor/handlers.js
 */

'use strict'

const { createHash } = require('crypto')
const { TransactionHandler } = require('sawtooth-sdk/processor')
const { InvalidTransaction } = require('sawtooth-sdk/processor/exceptions')
const { TransactionHeader } = require('sawtooth-sdk/protobuf')

// Encoding helpers and constants
const getAddress = (key, length = 64) => {
  return createHash('sha512').update(key).digest('hex').slice(0, length)
}

const FAMILY = 'transfer-chain'
const PREFIX = getAddress(FAMILY, 6)
const REG_NUM_INDEX = 0
const COST_PRICE_INDEX = 5
const SELLING_PRICE_INDEX = 6
const SEPARATOR = ", "

const getAssetAddress = name => PREFIX + '00' + getAddress(name, 62)
const getTransferAddress = asset => PREFIX + '01' + getAddress(getAssetByIndex(asset, REG_NUM_INDEX), 62)

const encode = obj => Buffer.from(JSON.stringify(obj, Object.keys(obj).sort()))
const decode = buf => JSON.parse(buf.toString())

const getAssetByIndex = (asset, index) => {
  const data = asset.split(SEPARATOR)
  return data[index]
}

const getAssetByName = (asset, field) => {
  const data = asset.substr(asset.indexOf(field) + field.length + 2);
  return getAssetByIndex(data, 0)  
}

// Add a new asset to state
const createAsset = (asset, owner, state) => {
  const address = getAssetAddress(getAssetByIndex(asset, REG_NUM_INDEX))

  return state.get([address])
    .then(entries => {
      const entry = entries[address]
      if (entry && entry.length > 0) {
        throw new InvalidTransaction('Asset name in use')
      }
      console.log("Reg Number = "+ getAssetByName(asset, "Registration-Number"))
      console.log("Color = "+ getAssetByName(asset, "Color"))
      console.log("Model = "+ getAssetByName(asset, "Model"))
      console.log("Manufacturer = "+ getAssetByName(asset, "Manufacturer"))
      console.log("Date-Of-Build = "+ getAssetByName(asset, "Date-Of-Build"))
      console.log("Cost-Price = "+ getAssetByName(asset, "Cost-Price"))

      return state.set({
        [address]: encode({name: asset, owner})
      })
    })
}

// Add a new transfer to state
const transferAsset = (asset, owner, signer, state) => {
  const address = getTransferAddress(getAssetByIndex(asset, REG_NUM_INDEX))
  const assetAddress = getAssetAddress(getAssetByIndex(asset, REG_NUM_INDEX))
  
  return state.get([assetAddress])
    .then(entries => {
      const entry = entries[assetAddress]
      console.log("entry :  "+ entry)
      if (!entry || entry.length === 0) {
        throw new InvalidTransaction('Asset does not exist')
      }

      if (signer !== decode(entry).owner) {
        throw new InvalidTransaction('Only an Asset\'s owner may transfer it')
      }

      return state.set({
        [address]: encode({asset, owner})
      })
    })
}

const updatePrice = (asset) => {
  const costPriceValue = getAssetByName(asset, "Cost-Price")
  const sellPriceValue = getAssetByName(asset, "Selling-Price")
  const updatedAsset = asset.replace("Cost-Price->"+costPriceValue,"Cost-Price->"+sellPriceValue)
                            .replace(SEPARATOR + "Selling-Price->"+sellPriceValue,"")
  return updatedAsset
}

const updateDateOfSale = (asset) => {
  var currentDate = new Date() 
  var dd = currentDate.getDate();
  var mm = currentDate.getMonth()+1;

  var yyyy = currentDate.getFullYear();
  if(dd<10){
      dd='0'+dd;
  } 
  if(mm<10){
      mm='0'+mm;
  } 
  currentDate = yyyy+'-'+mm+'-'+dd;
  const updatedAsset = asset + (SEPARATOR + "Date-Of-Sale->" + currentDate)
  console.log("updatedAsset:"+ updatedAsset)
  return updatedAsset
}
// Accept a transfer, clearing it and changing asset ownership
const acceptTransfer = (asset, signer, state) => {
  const address = getTransferAddress(getAssetByIndex(asset, REG_NUM_INDEX))

  return state.get([address])
    .then(entries => {
      const entry = entries[address]
      console.log("signer : "+ signer)
      console.log("owner : "+ decode(entry).owner)
      if (!entry || entry.length === 0) {
        throw new InvalidTransaction('Asset is not being transfered')
      }

      if (signer !== decode(entry).owner) {
        throw new InvalidTransaction(
          'Transfers can only be accepted by the new owner'
        )
      }
      asset = updatePrice(asset)
      asset = updateDateOfSale(asset)
      console.log("asset again :" + asset)
      return state.set({
        [address]: Buffer(0),
        [getAssetAddress(getAssetByIndex(asset, REG_NUM_INDEX))]: encode({name: asset, owner: signer})
      })
    })
}

// Reject a transfer
const rejectTransfer = (asset, signer, state) => {
  const address = getTransferAddress(getAssetByIndex(asset, REG_NUM_INDEX))

  return state.get([address])
    .then(entries => {
      const entry = entries[address]
      if (!entry || entry.length === 0) {
        throw new InvalidTransaction('Asset is not being transfered')
      }

      if (signer !== decode(entry).owner) {
        throw new InvalidTransaction(
          'Transfers can only be rejected by the potential new owner')
      }

      return state.set({
        [address]: Buffer(0)
      })
    })
}

// Handler for JSON encoded payloads
class JSONHandler extends TransactionHandler {
  constructor () {
    console.log('Initializing JSON handler for Sawtooth Car Chain')
    super(FAMILY, '0.0', 'application/json', [PREFIX])
  }

  apply (txn, state) {
    // Parse the transaction header and payload
    const header = TransactionHeader.decode(txn.header)
    const signer = header.signerPubkey
    const { action, asset, owner } = JSON.parse(txn.payload)

    // Call the appropriate function based on the payload's action
    console.log(`Handling transaction:  ${action} > ${asset}`,
                owner ? `> ${owner.slice(0, 8)}... ` : '',
                `:: ${signer.slice(0, 8)}...`)

    if (action === 'create') return createAsset(asset, signer, state)
    if (action === 'transfer') return transferAsset(asset, owner, signer, state)
    if (action === 'accept') return acceptTransfer(asset, signer, state)
    if (action === 'reject') return rejectTransfer(asset, signer, state)

    return Promise.resolve().then(() => {
      throw new InvalidTransaction(
        'Action must be "create", "transfer", "accept", or "reject"'
      )
    })
  }
}

module.exports = {
  JSONHandler
}
