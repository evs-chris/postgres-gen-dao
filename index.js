"use strict";

var _ = require('lodash');
var pg = require('postgres-gen');
var norm = pg.normalizeQueryArguments;

var log;
try {
  log = require('blue-ox')('dao');
} catch (e) {
  log = (function() {
    var fn = function() {};
    return { fatal: fn, error: fn, warn: fn, debug: fn, trace: fn };
  })();
}

function camelCase(name) { return name.replace(/_([a-zA-Z])/g, function(m) { return m.slice(1).toUpperCase(); }); }
function snakeCase(name) { return name.replace(/([A-Z])/g, function(m) { return '_' + m.toLowerCase(); }); }
function ident(name) {
  if (name.indexOf('"') === 0 || name.lastIndexOf('"') === name.length - 1) return name;
  else return '"' + name.replace(/"/, '""') + '"';
}

var registry = {};

function qlToQuery(params) {
  params = params || {};
  var daoCache = params.db.connectionString();
  var query = params.query || '';
  var tables = {};
  var sql = '';
  sql = query.replace(/@"?([a-zA-Z_]*[a-zA-Z0-9_]*)"?\s*[aA][sS]\s*"?([a-zA-Z_]*[a-zA-Z0-9_]*)"?/g, function(m, tbl, alias) {
    tables[alias] = daoCache[tbl];
    return ident(tbl) + ' as ' + ident(alias);
  });
  sql = sql.replace(/@([a-zA-Z_]*[a-zA-Z0-9_]*)\.\*/g, function(m, alias) {
    var dao = tables[alias];
    var arr = [];
    for (var c in dao.columns) {
      arr.push(ident(alias) + '.' + ident(dao.columns[c].name) + ' AS ' + ident('_' + alias + '__' + dao.columns[c].name));
    }
    return arr.join(', ');
  });

  return {
    query: query,
    aliases: tables
  };
}

var gopts = {
  camelCase: true,
  optimisticConcurrency: {
    value: function(i) { return new Date(); },
    columns: ['updated_at']
  }
};

module.exports = function(opts) {
  opts = opts || {};
  var out = opts.target || {};
  var db = opts.db;
  var useCamelCase = (opts.hasOwnProperty('camelCase') ? opts.camelCase : (gopts.hasOwnProperty('camelCase') ? gopts.camelCase : true));
  var concurrency = opts.optimisticConcurrency || {};
  var gconcurrency = gopts.optimisticConcurrency || {};
  var optConcur = concurrency.columns || gconcurrency.columns || [];
  var concurVal = concurrency.value || gconcurrency.value || function() { return new Date(); };
  var table = opts.table;
  out.prototype = opts.prototype || {};
  
  // always start unloaded
  out.prototype._generated_loaded = false;

  if (!(opts.hasOwnProperty('skipRegistry') ? opts.skipRegistry : false)) {
    var daoCache = registry[db.connectionString()] || {};
    registry[db.connectionString()] = daoCache;
    if (daoCache.hasOwnProperty(table)) {
      return daoCache[table];
    }
    daoCache[table] = out;
  }

  function cacheName(table, keys) {
    return table + '[' + keys.join(',') + ']';
  }

  var columns = db.query(
    'select a.attname as name, a.atthasdef or not a.attnotnull as elidable,' +
    ' (select conkey from pg_catalog.pg_constraint where conrelid = a.attrelid and contype = $type) @> ARRAY[a.attnum] as pkey' +
    ' from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid where c.relname = $table and a.attnum >= 0;',
  { table: table, type: 'p' }).then(function(rs) {
    out.columns = _.map(rs.rows, function(r) { return _.pick(r, ['name', 'elidable', 'pkey']); });
    log.trace('columns for %s are %j', table, out.columns);
    return out.columns;
  });

  var ready = columns.then(function(cols) {
    var arr = [];
    for (var c in cols) {
      if (!!cols[c].pkey) arr.push(cols[c].name);
    }
    arr.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    out.keys = arr;

    out.find = find;
    out.findOne = findOne;
    out.insert = insert;
    out.update = update;
    out.upsert = upsert;
    out.delete = del;
    out.load = load;
  });

  out.db = db;
  out.table = table;

  out.new = function() {
    return Object.create(out.prototype);
  };

  var find = function(conditions) {
    return db.query(norm(['SELECT * FROM ' + ident(table) + (!!conditions ? ' WHERE ' + conditions : '') + ';'].concat(Array.prototype.slice.call(arguments, 1)))).then(function(rs) {
      var cache = {};
      return _.map(rs.rows, function(r) {
        return out.load(r, { cache: cache });
      });
    });
  };
  out.find = function() { return ready.then(function() { return find.apply(out, Array.prototype.slice.call(arguments, 0)); }); };

  var findOne = function(conditions) {
    return db.queryOne(norm(['SELECT * FROM ' + ident(table) + (!!conditions ? ' WHERE ' + conditions : '') + ';'].concat(Array.prototype.slice.call(arguments, 1)))).then(function(rs) {
      return out.load(rs);
    });
  };
  out.findOne = function() { return ready.then(function() { return findOne.apply(out, Array.prototype.slice.call(arguments, 0)); }); };

  var insert = function insert(obj) {
    var sql = 'INSERT INTO "' + table + '" (\n\t';
    var cols = [], params = [], fetch = [];
    var c, col, nm, columns = out.columns;
    for (c in columns) {
      col = columns[c];
      nm = obj.hasOwnProperty(col.name) ? col.name : camelCase(col.name);
      if (obj.hasOwnProperty(nm)) {
        cols.push(ident(col.name));
        params.push('$' + nm);
      } else if (col.elidable) {
        fetch.push(col.name);
      } else throw new Error('Missing non-elidable column ' + col.name + '.');
    }
    sql += cols.join(', ');
    sql += '\n) VALUES (\n\t';
    sql += params.join(', ') + '\n)';
    if (fetch.length > 0)
      sql += ' RETURNING ' + fetch.join(', ') + ';';

    return db.queryOne(sql, obj).then(function(r) {
      for (var c in fetch) {
        obj[useCamelCase ? camelCase(fetch[c]) : fetch[c]] = r[fetch[c]];
      }
      obj._generated_loaded = true;
      return obj;
    });
  };
  out.insert = function(obj) { return ready.then(function() { return insert(obj); }); };

  var update = function(obj) {
    var sql = 'UPDATE "' + table + '" SET\n\t';
    var cols = [], cond = [], tmp = [], fetch = [];
    var c, col, nm, tnm;
    for (c in out.columns) {
      col = out.columns[c];
      tnm = nm = obj.hasOwnProperty(col.name) ? col.name : camelCase(col.name);
      if (out.keys.indexOf(col.name) < 0 && optConcur.indexOf(col.name) < 0) {
        cols.push({ name: col.name, value: nm });
      } else {
        if (optConcur.indexOf(col.name) >= 0) {
          var v = concurVal(col.name);
          tnm = '_generated_' + col.name;
          obj[tnm] = v;
          fetch.push({ name: nm, value: v });
          cols.push({ name: col.name, value: tnm });
        }
        cond.push({ name: col.name, value: nm });
      }
    }

    for (c in cols) { tmp.push(ident(cols[c].name) + ' = $' + cols[c].value); }
    sql += tmp.join(', ');
    sql += '\nWHERE\n\t';

    tmp = [];
    for (c in cond) {
      nm = cond[c].value;
      if (obj[nm] === null || obj[nm] === undefined) tmp.push(ident(cond[c].name) + ' is null');
      else tmp.push(ident(cond[c].name) + ' = $' + cond[c].value);
    }
    sql += tmp.join(' AND ') + ';';

    return db.nonQuery(sql, obj).then(function(rs) {
      if (rs != 1) throw new Error('Wrong number of results. Expected 1. Got ' + rs + '.');
      var c;
      for (c in fetch) obj[fetch[c].name] = fetch[c].value;
      for (c in optConcur) {
        delete obj['_generated_' + optConcur[c]];
      }
      return obj;
    });
  };
  out.update = function(obj) { return ready.then(function() { return update(obj); }); };

  var upsert = function(obj) {
    if (!!obj._generated_loaded) return out.update(obj);
    else {
      var res = true, cols = out.columns;
      for (var i = 0; res && i < cols.length; i++) {
        if (!!!cols[i].elidable || !obj.hasOwnProperty(cols[i].name)) res = false;
      }
      if (res) return out.update(obj);
      else return out.insert(obj);
    }
  };
  out.upsert = function(obj) { return ready.then(function() { return upsert(obj); }); };

  var del = function() {
    if (arguments.length < 1) return Promise.reject('Refusing to empty the ' + table + ' table.');
    if (typeof arguments[0] === 'string') {
      return db.nonQuery(norm(Array.prototype.concat('DELETE FROM ' + ident(table) + ' WHERE ' + arguments[0], Array.prototype.slice.call(arguments, 1))));
    } else if (arguments[0].hasOwnProperty('_generated_loaded')) {
      var obj = arguments[0];
      var sql = 'DELETE FROM ' + ident(table) + ' WHERE\n\t';
      var params = [];
      for (var c in out.columns) {
        c = out.columns[c];
        if (c.pkey || optConcur.indexOf(c.name) > -1) {
          if (params.length > 0) sql += ', ';
          sql += ident(c.name) + ' = ?';
          var name = obj.hasOwnProperty(c.name) ? c.name : camelCase(c.name);
          params.push(obj[name]);
        }
      }
      sql += ';';

      if (params.length < 1) return Promise.reject(new Error('Can\'t identify this object in the database.'));

      return db.transaction(function*() {
        var count = yield db.nonQuery(sql, params);
        if (count !== 1) throw new Error('Too many records deleted. Expected 1, tried to delete ' + count + '.');
        delete obj['_generated_loaded'];
        return count;
      });
    }
  };
  out.delete = function() { return ready.then(function() { return del.call(out, Array.prototype.slice.call(arguments, 0)); }); };

  out.aliasColumns = function(alias) {
    var cols = [];
    for (var c in out.columns) {
      cols.push(ident(alias) + '.' + ident(out.columns[c].name) + ' AS ' + ident('_' + alias + '__' + out.columns[c].name));
    }
    return cols.join(', ');
  };

  var load = function(rec, options) {
    var c, col, res;
    options = options || {};
    var alias = (!!options.alias ? '_' + options.alias + '__' : '');
    var lookup = cacheName(rec, _.map(out.keys, function(k) { return rec[k]; }));
    var cache = options.cache || {};

    if (cache.hasOwnProperty(lookup)) return cache[lookup];

    res = out.new();
    res._generated_loaded = true;
    for (c in out.columns) {
      col = out.columns[c].name;
      res[camelCase(col)] = rec[alias + col];
    }

    // TODO: load associations from options

    return res;
  };
  out.load = function(rec, options) { return ready.then(function() { return load(rec, options); }); };

  // TODO: add table reference support for join handling
  /*out.reference = function() {
    // function select
    // function field(name)
    // property map alias -> field
  };*/

  out.option = function(opt, value) {
    if (arguments.length == 1) return opts[opt];
    else opts[opt] = value;
  };

  out.options = function(options) {
    if (Array.isArray(options)) {
      var res = [];
      for (var o in options) res.push(opts[options[o]]);
      return res;
    } else {
      for (var k in options) {
        opts[k] = options[k];
      }
    }
  };

  return out;
};

module.exports.clearRegistry = function() { registry = {}; };

module.exports.option = function(opt, value) {
  if (arguments.length == 1) return gopts[opt];
  else gopts[opt] = value;
};

module.exports.options = function(options) {
  if (Array.isArray(options)) {
    var res = [];
    for (var o in options) res.push(gopts[options[o]]);
    return res;
  } else {
    for (var k in options) {
      gopts[k] = options[k];
    }
  }
};
