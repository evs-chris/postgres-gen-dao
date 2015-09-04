"use strict";

/* global before, after, it, describe */

global.Promise = require('when/es6-shim/Promise');

var should = require('should');
var assert = require('assert');
var mod = require('./');
var pg = require('postgres-gen');
var db = pg({ host: 'localhost', db: 'postgres_gen_test', user: 'postgres_gen_test', password: 'postgres_gen_test' });

var dao, otherDao, thirdDao, keylessDao, optimistDao;
var proto = { foo: true };

var stmts = [];
db.log(function(m) { stmts.push(m); });

function logerr(then) {
  return function(err) {
    console.log(err);
    then(err);
  };
}

before(function(done) {
  db.transaction(function*() {
    yield db.nonQuery('drop table if exists test;');
    yield db.nonQuery('drop table if exists other;');
    yield db.nonQuery('drop table if exists third;');
    yield db.nonQuery('drop table if exists keyless;');
    yield db.nonQuery('drop table if exists optimist;');
    yield db.nonQuery('create table test (id bigserial primary key, name varchar, email varchar);');
    yield db.nonQuery('create table other (id bigserial primary key, test_id bigint, value varchar);');
    yield db.nonQuery('create table third (id bigserial primary key, other_id bigint, value varchar, stuff json);');
    yield db.nonQuery('create table keyless (str varchar, flag boolean, num integer);');
    yield db.nonQuery('create table optimist (id bigserial primary key, name varchar, updated_at timestamptz not null default CURRENT_TIMESTAMP(3));');
    dao = mod({ db: db, table: 'test', prototype: proto });
    otherDao = mod({ db: db, table: 'other' });
    thirdDao = mod({ db: db, table: 'third' });
    keylessDao = mod({ db: db, table: 'keyless' });
    optimistDao = mod({ db: db, table: 'optimist' });
    (yield dao.find()).length.should.equal(0);
    (yield otherDao.find()).length.should.equal(0);
    (yield keylessDao.find()).length.should.equal(0);
    (yield optimistDao.find()).length.should.equal(0);
    dao.columns.length.should.equal(3);
  }).then(done, done);
});

after(function(done) {
  db.nonQuery('drop table test; drop table other; drop table third; drop table keyless; drop table optimist;').then(function() { done(); }, done);
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

  it('should update existing records for update with id and optimistic concurrency field', function(done) {
    db.transaction(function*() {
      var i = yield optimistDao.upsert({ name: 'Joe' });
      i.id.should.equal('1');
      i.name.should.equal('Joe');
      i = yield optimistDao.upsert({ id: i.id, updatedAt: i.updatedAt, name: 'George' });
      i.id.should.equal('1');
      i.name.should.equal('George');
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

  it('should properly handle non-object json on insert', function(done) {
    db.transaction(function*(t) {
      yield thirdDao.insert({ value: 'one', stuff: [1, 2, 3] }, { t: t });
      yield thirdDao.insert({ value: 'two', stuff: 'str' }, { t: t });
      yield thirdDao.insert({ value: 'three', stuff: 15.2 }, { t: t });
      yield thirdDao.insert({ value: 'four', stuff: false }, { t: t });
      yield thirdDao.insert({ value: 'five', stuff: null }, { t: t });

      var one = yield thirdDao.findOne('value = ?', 'one', { t: t });
      var two = yield thirdDao.findOne('value = ?', 'two', { t: t });
      var three = yield thirdDao.findOne('value = ?', 'three', { t: t });
      var four = yield thirdDao.findOne('value = ?', 'four', { t: t });
      var five = yield thirdDao.findOne('value = ?', 'five', { t: t });

      one.stuff[0].should.equal(1);
      two.stuff.should.equal('str');
      three.stuff.should.equal(15.2);
      four.stuff.should.equal(false);
      should.equal(five.stuff, null);
    }).then(done, logerr(done));
  });

  it('should properly handle non-object json on update', function(done) {
    db.transaction(function*(t) {
      var one = yield thirdDao.findOne('value = ?', 'one', { t: t });
      var two = yield thirdDao.findOne('value = ?', 'two', { t: t });
      var three = yield thirdDao.findOne('value = ?', 'three', { t: t });
      var four = yield thirdDao.findOne('value = ?', 'four', { t: t });
      var five = yield thirdDao.findOne('value = ?', 'five', { t: t });

      one.stuff = [4, 5, 6];
      yield thirdDao.update(one, { t: t });
      one = yield thirdDao.findOne('value = ?', 'one', { t: t });

      two.stuff = 'rts';
      yield thirdDao.update(two, { t: t });
      two = yield thirdDao.findOne('value = ?', 'two', { t: t });

      three.stuff = 99.1;
      yield thirdDao.update(three, { t: t });
      three = yield thirdDao.findOne('value = ?', 'three', { t: t });

      four.stuff = true;
      yield thirdDao.update(four, { t: t });
      four = yield thirdDao.findOne('value = ?', 'four', { t: t });

      five.stuff = null;
      yield thirdDao.update(five, { t: t });
      five = yield thirdDao.findOne('value = ?', 'five', { t: t });

      one.stuff[0].should.equal(4);
      two.stuff.should.equal('rts');
      three.stuff.should.equal(99.1);
      four.stuff.should.equal(true);
      should.equal(five.stuff, null);
    }).then(done, logerr(done));
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
      var ks = yield keylessDao.find('order by num asc');
      ks.length.should.equal(2);
      ks[0].str.should.equal('bar');
      ks[1].str.should.equal('foo');
    }).then(done, done);
  });

  it('should handle order only queries', function(done) {
    db.transaction(function*() {
      var ts = yield dao.find('order by id desc');
      ts[0].id.should.equal('' + ts.length);
    }).then(done, done);
  });

  it('should handle queries that start with "where"', function(done) {
    db.transaction(function*() {
      var ts = yield dao.find('where id = ?', 1);
      ts[0].id.should.equal('1');
    }).then(done, done);
  });

  it('should handle queries that are just randomw whitespace', function(done) {
    db.transaction(function*() {
      var ts = yield dao.find('  \t\n\n\r \n');
      ts.length.should.be.greaterThan(1);
    }).then(done, done);
  });

  describe('fetching', function() {
    it('should properly fetch associated records', function(done) {
      db.transaction(function*(t) {
        yield thirdDao.insert({ value: 'first third', other_id: 1 });
        let rs = yield dao.query('select t.*, @others.*, @last.* from test t left join @other others on others.test_id = t.id left join @third last on last.other_id = others.id where t.id = 1', { fetch: { others: [{ last: '' }] }, t });
        let os = yield otherDao.find('test_id = 1');
        let ts = yield thirdDao.find('other_id = ?', os[0].id);
        rs.length.should.equal(1);
        rs[0].others.length.should.equal(os.length);
        rs[0].others[0].last.id.should.equal(ts[0].id);
        should.equal(rs[0].others[1].last, undefined);
      }).then(done, done);
    });
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
