const cbor = require('borc')
const multihashes = require('multihashes')
const crypto = require('crypto')
const CID = require('cids')
const Block = require('ipfs-block')
const isCircular = require('is-circular')

const sha2 = b => crypto.createHash('sha256').update(b).digest()

const CID_CBOR_TAG = 42

/* start copy from exisisting dag-cbor */
function tagCID (cid) {
  if (typeof cid === 'string') {
    cid = new CID(cid).buffer
  }

  return new cbor.Tagged(CID_CBOR_TAG, Buffer.concat([
    Buffer.from('00', 'hex'), // thanks jdag
    cid
  ]))
}

function replaceCIDbyTAG (dagNode) {
  let circular
  try {
    circular = isCircular(dagNode)
  } catch (e) {
    circular = false
  }
  if (circular) {
    throw new Error('The object passed has circular references')
  }

  function transform (obj) {
    if (!obj || Buffer.isBuffer(obj) || typeof obj === 'string') {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(transform)
    }

    const keys = Object.keys(obj)

    // only `{'/': 'link'}` are valid
    if (keys.length === 1 && keys[0] === '/') {
      // Multiaddr encoding
      // if (typeof link === 'string' && isMultiaddr(link)) {
      //  link = new Multiaddr(link).buffer
      // }

      return tagCID(obj['/'])
    } else if (keys.length > 0) {
      // Recursive transform
      let out = {}
      keys.forEach((key) => {
        if (typeof obj[key] === 'object') {
          out[key] = transform(obj[key])
        } else {
          out[key] = obj[key]
        }
      })
      return out
    } else {
      return obj
    }
  }

  return transform(dagNode)
}
/* end copy from existing dag-cbor */

const chunk = function * (buffer, size) {
  let i = 0
  yield buffer.slice(i, i + size)
  while (i < buffer.length) {
    i += size
    yield buffer.slice(i, i + size)
  }
}
const asBlock = (buffer, type) => {
  let hash = multihashes.encode(sha2(buffer), 'sha2-256')
  let cid = new CID(1, type, hash)
  return new Block(buffer, cid)
}

class NotFound extends Error {
  get code () {
    return 404
  }
}

class IPLD {
  constructor (get, maxsize = 1e+7 /* 10megs */) {
    this._get = get
    this._maxBlockSize = 1e+6 // 1meg
    this._maxSize = maxsize
    this._decoder = new cbor.Decoder({
      tags: {
        [CID_CBOR_TAG]: (val) => {
          val = val.slice(1)
          return {'/': val}
        }
      },
      size: maxsize
    })
  }
  get multicodec () {
    return 'dag-cbor'
  }
  _cid (buffer) {
    let hash = multihashes.encode(sha2(buffer), 'sha2-256')
    let cid = new CID(1, 'dag-cbor', hash)
    return cid.toBaseEncodedString()
  }
  async cids (buffer) {
    return (function * () {
      yield this._cid(buffer)
      let root = this._deserialize(buffer)
      if (root['._'] === 'dag-split') {
        let cids = root.chunks.map(b => b['/'])
        for (let cid of cids) {
          yield cid
        }
      }
    })()
    // return [iterable of cids]
  }
  async resolve (buffer, path) {
    if (!Array.isArray(path)) {
      path = path.split('/').filter(x => x)
    }
    let root = await this.deserialize(buffer)

    while (path.length) {
      let prop = path.shift()
      root = root[prop]
      if (typeof root === 'undefined') {
        throw NotFound(`Cannot find link "${prop}".`)
      }
      if (typeof root === 'object' && root['/']) {
        let c = new CID(root['/'])
        if (c.codec !== 'dag-cbor') {
          return {value: c, remaining: path.join('/')}
        }
        return this.resolve(await this._get(root['/']), path)
      }
    }
    return {value: root, remaining: path.join('/')}
  }
  _deserialize (buffer) {
    return this._decoder.decodeFirst(buffer)
  }
  _serialize (dagNode) {
    let dagNodeTagged = replaceCIDbyTAG(dagNode)
    return cbor.encode(dagNodeTagged)
  }
  serialize (dagNode) {
    // TODO: handle large objects
    let buffer = this._serialize(dagNode)
    if (buffer.length > this._maxSize) {
      throw new Error('cbor node is too large.')
    }
    if (buffer.length > this._maxBlockSize) {
      return (function * () {
        let node = {'._': 'dag-split'}
        node.chunks = []
        for (let _chunk of chunk(buffer, this._maxBlockSize)) {
          let block = asBlock(_chunk, 'raw')
          yield block
          node.chunks.push({'/': block.cid.toBaseEncodedString()})
        }
        yield asBlock(this._serialize(node), 'dag-cbor')
      })()
    } else {
      return [asBlock(buffer, 'dag-cbor')]
    }
    // return iterable of Blocks
  }
  async deserialize (buffer) {
    let root = this._deserialize(buffer)
    if (root['._'] === 'dag-split') {
      let cids = root.chunks.map(b => b['/'])
      let blocks = [cids.map(c => this._get(c))]
      let buffer = Buffer.concat(await Promise.all(blocks))
      return this._deserialize(buffer)
    } else {
      return root
    }
    // return native type
  }
  async tree (buffer) {
    let root = this._deserialize(buffer)
    if (root['._'] === 'dag-split') {
      let cids = root.chunks.map(b => b['/'])
      return (async function * () {
        for (let cid of cids) {
          let block = await this._get(cid)
          let obj = this._deserialize(block)
          for (let key of Object.keys(obj)) {
            yield key
          }
        }
      })()
    } else {
      return Object.keys(root)
    }
    // returns iterable of keys
  }
}

module.exports = (get) => new IPLD()
