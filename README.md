# Proposal for alternative interface for IPLD.

## `ipld(getBlock)`

Must return IPLD Interface.

`getBlock` is an async function that accepts a CID and returns a promise for
the binary blob of that CID.

## IPLD.serialize(native object)

Takes a native object that can be serialized.

Returns an iterable. All items in iterable much be instances of `Block` or
promises that resolve instances of `Block`.

When returning multiple blocks the **last** block must be the root block.

## IPLD.deserialize(buffer)

Takes a binary blob to be deserialized.

Returns a promise to a native object.

## IPLD.tree(buffer)

Takes a binary blob of a serialzed node.

Returns an iterable. All item sin iterable must be either strings or promises that resolve to strings.

## IPLD.resolve(buffer, path)

Takes a binary blob of a serialized node and a path to child links.

Returns a promise to an object with two properties: `value` and `remaining`.

`value` must be either a deserialized node or a CID instance.

`remaining` must be a string of the remaining path.

Throws an Error() when path cannot be resolved. Error instance should have a
`.code` attribute set to `404`.

## IPLD.cids(buffer)

Takes a binary blob of a serialize node.

Returns an iterator. All items in the iterator must be instances of CIDor promises that resolve to instances of CID.

Returns only the CID's required to deserialize this node. Must not contain CID's of named links.
