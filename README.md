# postgres-gen-dao

postgres-gen-dao is a simple DAO library built on postgres-gen and pg. Its goal is to remove the boilerplate associated with marshalling objects to and from tables.

As an aside, PostgreSQL JSON support is very very nice in node.js. Starting with 9.3 and the hstore-json merger, tilt tables are a thing of the past.

## Usage

```javascript
var db = '...'; // your postgres-gen db here
var dao = require('postgres-gen-dao');
var books = doa({ db: db, table: 'books' });

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
```

Since all of the query methods return a promise (from postgres-gen), this plays nicely with generator-based flow control.

## TODO:

* [ ] Support table multi-table results that have child objects loaded automatically
* [ ] Support deleting objects
