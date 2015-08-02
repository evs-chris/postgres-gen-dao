# postgres-gen-dao

postgres-gen-dao is a simple DAO library built on postgres-gen and pg. Its goal is to remove the boilerplate associated with marshalling objects to and from tables.

As an aside, PostgreSQL JSON support is very very nice in node.js. Starting with 9.4 and the hstore-json merger, tilt tables are a thing of the past.

## Usage

```javascript
var db = '...'; // your postgres-gen db here
var dao = require('postgres-gen-dao');
var books = dao({ db: db, table: 'books' });

// let's assume our table is id:bigserial-primarykey, author:varchar, title:varchar, published:integer, details:json, created_at:timestamptz-current_timestamp(3), updated_at:timestamptz-current_timestamp(3)
var b = { author: 'John Public', title: 'I Like Books', published: 1733, details: { binding: 'leather', color: 'red' } };

// upsert will insert or update depending on whether or not dao knows it loaded the record or all of the elidable fields are present
// explicit insert and update are also available
books.upsert(b).then(function() {
  // b will be updated at this point and will be the first argument to this callback
  console.log(b.id + ' - ' + b.createdAt + ' - ' + b.updatedAt); // elidable values are loaded back from the inserted record

  books.find('author = ?', 'John Public').then(function(bs) {
    // bs is an array of books by John Public
  });
  
  books.find().then(function(bs) {
    // bs is an array of all books
  });

  books.findOne('id = ?', 1).then(function(b) {
    // b is book with id 1
  });
});

db.transaction(function*() {
  var b = yield books.findOne('id = ?', 1);
  yield dao.delete(b); // delete by model, will throw if more than one row is affected
  yield dao.delete('published > 1967'); // delete by query, returns count
});
```

Since all of the query methods return a promise (from postgres-gen), this plays nicely with generator-based flow control.

## Init Note

For legacy reasons, the initialization of the DAO object is not fully complete when it is returned. If you need to wait for full initialization, you can use the supplied `ready` Promise to do so.

```js
var books = dao({ db: db, table: 'books' });
// books is the actual DAO, and query methods can be used. They will just not be started until init is complete.
books.then(bs => {
  // bs === books, but this only fires after init is complete
});
```

For simple queries, this doesn't matter much in practice, but if you have ql queries that reference multiple DAOs, you can get malformed SQL before init is complete.

## ql

ql is the slight adjustment to SQL that allows references to DAO tables and columns to be referenced at a higher level with the details being filled in automatically. It uses `@` references with optional aliases to look up which DAO table and columns to inject into the query. For instance, `SELECT @b.*, @a.* from @books b join @authors a on b.author_id = a.id;` will look up the models with for tables `books` and `authors` and replace `@b.*` and `@a.*` with a full aliased field list and substitute the tables names for `@books` and `@authors`. Individual fields can also be referenced using `@b.author_id`, which will result in an aliased field reference (`"b"."author_id" AS "_b__author_id"`), or `@:b.author_id`, which will result in an alias reference (`"_b__author_id"`). The former is useful to select single fields from tables, and the latter is useful to reference single fields in complex queries, particularly those with CTEs.

The ql processor returns a substituted query and an alias map so that the `load` handler can retrieve models using their aliased fields.

## Keyless tables

Keyless tables are partially supported in that records can be inserted, loaded, and updated, but the method for doing so is not ideal. When a keyless record is loaded (or inserted), its values are cloned into a generated member, which is then used to target the record for updates and deletes. Keyless records are expected to be unique for updates and deletes.

## API

### `query( sql, [ parameters ], [ options ] )`

`query` allows you to run a ql query with optional parameters and collect the results into a more graph-like form.

`options` may specify an `extra` function or map of functions (per-alias) that will be called with each record and result object for every new row. This can be used to add computed fields to the object output of a query.

It may also specify a `fetch` map or its contents, similar to the way ActiveRecord specifies fetches. For instance, to specify that a `book` should have one author, `{ author: '' }`. If a book should have multiple authors, `{ authors: [] }`. The specifiers may be nested as needed, for instance, `{ authors: [{ publisher: '', commisions: [] }] }` would return books with and authors array where the authors each had a publisher and an array of comissions. Each key must match an alias in a ql query, or it will be ignored.

Any `options` keys that match an alias will be automatically included in the fetch map, so a `fetch` key is optional but may be more clear.

If an `exclude` map is provided, any fields for a table's alias in the exclude array will not be included in the `SELECT` statement. The keys of the map must match `@` referenced tables, e.g. `dao.query('select @t.* from @foo t;', {}, { exclude: { t: [ 'big_array_blob_field' ] } });`. In this example, the `big_array_blob_field` will not be included in the list of the `t.*` fields.

### `find|findOne( [ conditions ], [ parameters ], [ options ] )`

Both find and findOne take the same parameters. The only difference is findOne will throw if more than one result, which would otherwise be returned directly, is returned.

#### `options`

`exclude` - an array of column names to exclude from the query.
