## 0.15.1

* `find` and `findOne` conditions now properly handle:
  * whitespace-only strings, which are dropped
  * `ORDER BY` strings, which no longer have `WHERE` prepended
  * `WHERE` strings, which also no longer have `WHERE` prepended

## 0.15.0

* __BREAKING BUG:__ JSON columns will now have their values stringified prior to being used in an insert or update. This means that all valid JSON types can be used directly. If you were working around this bug by pre-stringifying, you should stop doing so or you will be inserting string literals into the database instead of JSON.

## 0.14.1

* __BUG:__ Fix fetching of objects nested in arrays (complex to-many associations).

## 0.14.0

* Adds aliases `trans` and `t` for the `transaction` option.
* Adjusts the way upserts for non-loaded objects are handled from completely broken to update if keys and optimistic concurrency fields are present.

## 0.13.0

* Expose `DAO.ready` promise to allow consumers to wait for the DAO to be fully initialized.

## 0.12.0

* Adds support for controlling the DAO cache.
* Adds support for converting empty strings to nulls for non-string fields.

## 0.11.0

* __BUG:__ Fixes support for loading records from a keyless table.
* Adds support for inserting and updating objects in a keyless table by using all of the values in the record as criteria. A `lastValues` object may also be supplied as an option to be used in place of the automatically cached version.

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
