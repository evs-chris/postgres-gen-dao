"use strict";

/* global before, after, it, describe */

global.Promise = require('when/es6-shim/Promise');

var should = require('should');
if (should) ; // - jshint shalt not whine about should being unused
var assert = require('assert');
var mod = require('./');
var pg = require('postgres-gen');
var db = pg({ host: 'localhost', db: 'postgres_gen_test', user: 'postgres_gen_test', password: 'postgres_gen_test' });

var dao, otherDao, keylessDao;
var proto = { foo: true };

var stmts = [];
db.log(function(m) { stmts.push(m); });

before(function(done) {
  db.transaction(function*() {
    yield db.nonQuery('drop table if exists test;');
    yield db.nonQuery('drop table if exists other;');
    yield db.nonQuery('drop table if exists keyless;');
    yield db.nonQuery('create table test (id bigserial primary key, name varchar, email varchar);');
    yield db.nonQuery('create table other (id bigserial primary key, test_id bigint, value varchar);');
    yield db.nonQuery('create table keyless (str varchar, flag boolean, num integer);');
    dao = mod({ db: db, table: 'test', prototype: proto });
    otherDao = mod({ db: db, table: 'other' });
    keylessDao = mod({ db: db, table: 'keyless' });
    (yield dao.find()).length.should.equal(0);
    (yield otherDao.find()).length.should.equal(0);
    (yield keylessDao.find()).length.should.equal(0);
    dao.columns.length.should.equal(3);
  }).then(done, done);
});

after(function(done) {
  db.nonQuery('drop table test; drop table other; drop table keyless;').then(function() { done(); }, done);
});

describe('dao object prototypes', function() {
  it('should be created if not supplied', function() {
    var dao = mod({ db: db, table: 'test', skipRegistry: true });
    dao.prototype.should.not.equal(undefined);
  });

  it('should use the given object as a prototype if supplied', function() {
    dao.prototype.should.equal(proto);
  });

  it('should be used for objects created by the dao', function() {
    var obj = dao.new();
    obj.foo.should.equal(true);
  });

  it('should allow properties to be set upon newing', function() {
    var target;
    var obj = dao.new({ id: '10t', name: 'Yep', nested: { obj: true }, es5: { get: function() { return 'hey'; }, set: function(v) { target = v; } } });
    obj.id.should.equal('10t');
    obj.name.should.equal('Yep');
    obj.nested.obj.should.equal(true);
    obj.es5.should.equal('hey');
    obj.es5 = 'foo';
    target.should.equal('foo');
  });
});

it('should have the table available', function(done) {
  db.query('select * from test;').then(function(rs) {
    try {
      rs.rows.length.should.equal(0);
      done();
    } catch (e) { done(e); }
  }, done);
});

describe('upserts, inserts, and updates', function() {
  it('should insert new records for insert or upsert', function(done) {
    db.transaction(function*() {
      var i = dao.new();
      i.name = 'John';
      yield dao.upsert(i);
      i.id.should.equal('1');
    }).then(done, done);
  });

  it('should update old records for update', function(done) {
    db.transaction(function*() {
      var i = yield dao.findOne('id = ?', 1);
      i.name.should.equal('John');
      i.name = 'Larry';
      i.email = 'larry@perl.org';
      yield dao.upsert(i);
      i = yield dao.findOne('id = ?', 1);
      i.name.should.equal('Larry');
      i.email.should.equal('larry@perl.org');
    }).then(done, done);
  });

  it('should only send available fields on update', function(done) {
    db.transaction(function*() {
      var i = yield dao.findOne('id = ?', 1);
      stmts = [];
      var name = i.name;
      delete i.name;
      yield dao.update(i);
      i = yield dao.findOne('id = ?', 1);
      i.name.should.equal(name);
      var q = stmts[0].query;
      q.should.match(/email/);
      q.should.not.match(/name/);
    }).then(done, done);
  });

  it('should be able to insert keyless records', function(done) {
    db.transaction(function*() {
      var i = keylessDao.new();
      i.str = 'foo';
      i.flag = true;
      i.num = 10;
      yield keylessDao.insert(i);
      i = yield keylessDao.find('num = ?', 10);
      i.length.should.equal(1);
      i[0].str.should.equal('foo');
    }).then(done, done);
  });

  it('should be able to update keyless records', function(done) {
    db.transaction(function*() {
      yield keylessDao.insert({ num: 12, str: 'foo', flag: true });
      var i = yield keylessDao.findOne('num = 10');
      i.str.should.equal('foo');
      i.num.should.equal(10);
      i.str = 'bar';
      i._generated_last_values.str.should.equal('foo');
      i = yield keylessDao.update(i);
      i._generated_last_values.str.should.equal('bar');
    }).then(done, done);
  });

  it('should replace empty string params for non-string fields with null', function(done) {
    db.transaction(function*(t) {
      var rec = yield keylessDao.insert({ num: '', str: 'asdf' }, { transaction: t });
      rec = yield keylessDao.findOne('str = ?', 'asdf', { transaction: t });
      assert(rec.num === null, 'num should be null');
      yield keylessDao.delete(rec, { transaction: t });
    }).then(done, done);
  });
});

describe('finding', function() {
  it('should find all when no conditions are passed to find', function(done) {
    db.transaction(function*() {
      yield dao.insert({ name: 'Susan' });
      var is = yield dao.find();
      is.length.should.equal(2);
    }).then(done, done);
  });

  it('should find first when no conditions are passed to findOne', function(done) {
    db.transaction(function*() {
      var i = yield dao.findOne();
      i.name.should.match(/Larry|Susan/);
    }).then(done, done);
  });

  it('should skip duplicates if processing a record set with the same object in it multiple times', function(done) {
    db.transaction(function*() {
      yield otherDao.insert({ value: 'Other 1', testId: 1 });
      yield otherDao.insert({ value: 'Other 2', testId: 1 });
      var ts = yield dao.query('select t.*, @others.* from test t join @other others on others.test_id = t.id where t.id = ?', 1, { others: [] });
      ts.length.should.equal(1);
      ts[0].others.length.should.equal(2);
      ts = yield dao.query('select t.*, @others.* from test t left join @other others on others.test_id = t.id', { others: [] });
      ts.length.should.equal(2);
    }).then(done, done);
  });

  it('should allow fields to be excluded for ql queries', function(done) {
    db.transaction(function*() {
      var ts = yield dao.query('select @t.* from @test t', {}, { exclude: { t: [ 'email' ] } });
      ts.length.should.equal(2);
      (ts[0].email === undefined).should.equal(true);
      ts[0].name.should.equal('Larry');
      (ts[1].email === undefined).should.equal(true);
    }).then(done, done);
  });

  it('should allow fields to be excluded for find queries', function(done) {
    db.transaction(function*() {
      var ts = yield dao.find({ exclude: [ 'email' ] });
      ts.length.should.equal(2);
      ts[0].name.should.equal('Larry');
      (ts[0].email === undefined).should.equal(true);

      ts = yield dao.find('name = ?', 'Larry', { exclude: [ 'email' ] });
      ts.length.should.equal(1);
      ts[0].name.should.equal('Larry');
      (ts[0].email === undefined).should.equal(true);

      var t = yield dao.findOne({ exclude: [ 'email' ] });
      t.name.should.equal('Larry');
      (t.email === undefined).should.equal(true);
      t = yield dao.findOne('name = ?', 'Susan', { exclude: [ 'email' ] });
      t.name.should.equal('Susan');
      (t.email === undefined).should.equal(true);
    }).then(done, done);
  });

  it('should be able to properly find records in a keyless table', function(done) {
    db.transaction(function*() {
      var ks = yield keylessDao.find('1 = 1 order by num asc');
      ks.length.should.equal(2);
      ks[0].str.should.equal('bar');
      ks[1].str.should.equal('foo');
    }).then(done, done);
  });
});

describe('deleting', function() {
  it('should delete a passed item and reset it', function(done) {
    db.transaction(function*() {
      var i = yield dao.findOne('id = 1');
      i._generated_loaded.should.equal(true);
      (yield dao.delete(i)).should.equal(1);
      i._generated_loaded.should.equal(false);
      (yield dao.find('id = 1')).length.should.equal(0);
    }).then(done, done);
  });

  it('should delete by query', function(done) {
    db.transaction(function*() {
      (yield dao.delete('id = 2')).should.equal(1);
      (yield dao.find('id = $foo', { foo: 2 })).length.should.equal(0);
    }).then(done, done);
  });

  it('should be able to delete records in a keyless table', function(done) {
    db.transaction(function*() {
      var i = yield keylessDao.findOne('num = 10');
      i._generated_loaded.should.equal(true);
      yield keylessDao.delete(i);
      (yield keylessDao.find('num = 10')).length.should.equal(0);
    }).then(done, done);
  });
});
