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