## 0.10.0

* Adds support for passing a transaction along through the DAO methods in case domains can't be used (or fall over).

## 0.9.0

* __BUG:__ Fixes support for non-aliased DAO references in QL queries. References followed by 'on' or 'where' no longer require an alias.
* __BUG:__ Carries extra modifiers to secondary object during load as well. There may still be some issues with how this is done for deep hierarchies.
* Adds support for alias-only field references in QL queries using `@:alias.field`. This makes it possible to more easily reference fields in complex queries, particularly those with CTEs.

## 0.8.1

* __BUG:__ Makes sure informational schemas (pg_cataolg, information_schema, etc) are excluded when looking up table metadata.

## 0.8.0

* Adds support for excluding fields in find and findOne.

## 0.7.0

* Adds support for excluding fields in ql queries.

## 0.6.0

* Adds support for automatically casting parameters in insert and update.
  * Automatically casts array parameters if they are present.

## 0.5.0

* Adds support for an extra record processor during record load.
* Adds support for referencing individual columns in aliased tables for ql.

## 0.4.2

* __BUG:__ Skips dropped columns when fetching table metadata.

## 0.4.1

* __BUG?:__ Avoids adding the same object to the query results multiple times when processing a joined result set.

## 0.4.0

* __BUG?:__ Limits updates to columns present within the update object to avoid setting missing columns to null. Columns that need to be set to null must explicitly be set to null to be included in an update query.

## 0.3.0

* Adds support for setting properties in dao.new using flat objects, property descriptors, or a mixture of the two.

## 0.2.0

* __BUG:__ Fixes calling convention for initial version of functions that require metadata to be collected before they can be run (find, update, etc).
* Fixes initial version of ql query parser that adjusts aliased tables prefixed with @ to be references to DAOs.
* Adds support for loading associated records from ql queries if a mapping is supplied.

## 0.1.0

* Supports deleting by object and by query
* __BUG:__ Waits for columns to be initialized before trying to use them
* Adds an initial test suite

## 0.0.1

Initial version supporting the creation of DAO objects that can insert, update, and upsert objects; query objects using a slightly more convenient spin on query and queryOne; and helper methods to make naming columns with aliases and pulling them back out of the result set easier.
