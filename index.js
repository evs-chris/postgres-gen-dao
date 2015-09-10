"use strict";

// TODO: computed columns in tables i.e. now()-datecol as age?

var _ = require('lodash');
var pg = require('postgres-gen');
var norm = pg.normalizeQueryArguments;

var log;
try {
  log = require('blue-ox')('dao');
} catch (e) {
  log = (function() {
    var fn = function() {};
    return { fatal: fn, error: fn, warn: fn, debug: fn, trace: fn, info: fn };
  })();
}

function camelCase(name) { return name.replace(/_([a-zA-Z])/g, function(m) { return m.slice(1).toUpperCase(); }); }
//function snakeCase(name) { return name.replace(/([A-Z])/g, function(m) { return '_' + m.toLowerCase(); }); }
function ident(name) {
  if (name.indexOf('"') === 0 && name.lastIndexOf('"') === name.length - 1) return name;
  else return '"' + name.replace(/"/, '""') + '"';
}

var registry = {};
var tableAliases = /@"?([a-zA-Z_]+[a-zA-Z0-9_]*)"?(?!\.)\s(?:(?!\s*(?:on|where)\s)\s*(?:[aA][sS])?\s*"?([a-zA-Z_]+[a-zA-Z0-9_]*)?"?)?/gi;
var fieldAliases = /@:?"?([a-zA-Z_]+[a-zA-Z0-9_]*)"?\."?([a-zA-Z_]+[a-zA-Z0-9_]+|\*)"?/gi;
var startsWithOrder = /^\s*order\s+/i, startsWithWhere = /^\s*where\s+/i, noText = /^\s*$/;

var qlToQuery = function(params) {
  params = params || {};
  var daoCache = this.registry;
  var query = params.query || '';
  var tables = {};
  var exclude = params.exclude || {};
  var sql = '';

  // map in other tables and record aliases
  sql = query.replace(tableAliases, function(m, tbl, alias) {
    tables[alias || tbl] = daoCache[tbl];
    return ident(tbl) + ' AS ' + ident(alias || tbl);
  });

  // map and expand aliased fields e.g. @alias.field and @alias.* or direct aliases @:alias.field
  sql = sql.replace(fieldAliases, function(m, alias, col) {
    var dao = tables[alias], c;
    if (!dao) return m;
    if (col === '*') {
      var arr = [];
      for (c in dao.columns) {
        if ((exclude[alias] || []).indexOf(dao.columns[c].name) === -1) {
          arr.push(ident(alias) + '.' + ident(dao.columns[c].name) + ' AS ' + ident('_' + alias + '__' + dao.columns[c].name));
        }
      }
      return arr.join(', ');
    } else {
      c = _.find(dao.columns, function(cc) { return cc.name === col; });
      if (!!c) return (m.indexOf(':') === -1 ? ident(alias) + '.' + ident(c.name) + ' AS ' : '') + ident('_' + alias + '__' + c.name);
      else return '';
    }
  });

  return {
    query: sql,
    aliases: tables
  };
};

var gopts = {
  camelCase: true,
  optimisticConcurrency: {
    value: function(/*i*/) { return new Date(); },
    columns: ['updated_at']
  }
};

module.exports = function(opts) {
  opts = opts || {};
  var casts = opts.cast || {};
  var out = opts.target || {};
  var db = opts.db;
  var useCamelCase = (opts.hasOwnProperty('camelCase') ? opts.camelCase : (gopts.hasOwnProperty('camelCase') ? gopts.camelCase : true));
  var emptyStringToNull = (opts.hasOwnProperty('emptyStringToNull') ? opts.emptyStringToNull : (gopts.hasOwnProperty('emptyStringToNull') ? gopts.emptyStringToNull : true));
  var concurrency = opts.optimisticConcurrency || {};
  var gconcurrency = gopts.optimisticConcurrency || {};
  var optConcur = concurrency.columns || gconcurrency.columns || [];
  var concurVal = concurrency.value || gconcurrency.value || function() { return new Date(); };
  var table = opts.table;
  out.prototype = opts.prototype || {};

  // always start unloaded
  out.prototype._generated_loaded = false;

  if (opts.skipCache !== true) {
    var daoCache = out.registry = opts.registry;
    if (!daoCache) {
      daoCache = out.registry = registry[db.connectionString()] || {};
      registry[db.connectionString()] = daoCache;
    }
    if (daoCache.hasOwnProperty(table)) {
      return daoCache[table];
    }
    daoCache[table] = out;
  }

  function cacheName(keys) {
    if (keys.length === 0) return '';
    return table + '[' + keys.join(',') + ']';
  }

  var columns = db.query(
    'select a.attname as name, a.atthasdef or not a.attnotnull as elidable,' +
    ' (select conkey from pg_catalog.pg_constraint where conrelid = a.attrelid and contype = $type) @> ARRAY[a.attnum] as pkey,' +
    ' (select t.typname from pg_catalog.pg_type t where t.oid = a.atttypid) as "type"' +
    ' from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid' +
    ' left join pg_catalog.pg_namespace n on n.oid = c.relnamespace' +
    ' where c.relname = $table and a.attnum >= 0' +
    ' and (n.nspname <> \'pg_catalog\' and n.nspname <> \'information_schema\' and n.nspname !~ \'^pg_toast\')' +
    ' and a.attisdropped = false;',
  { table: table, type: 'p' }).then(function(rs) {
    out.columns = _.map(rs.rows, function(r) { return _.pick(r, ['name', 'elidable', 'pkey', 'type']); });
    _.each(out.columns, function(c) {
      // if the type starts with _, it is an array and should be cast automagically
      if (!!casts[c.name]) c.cast = casts[c.name];
      else if (c.type.indexOf('_') === 0) c.cast = c.type;

      if (c.type.toLowerCase().indexOf('json') !== -1) c.json = true;
    });
    log.trace('columns for %s are %j', table, out.columns);
    return out.columns;
  });

  var ready = out.ready = columns.then(function(cols) {
    out.keys = [];

    for (var c in cols) {
      if (!!cols[c].pkey) out.keys.push(cols[c].name);
    }
    out.keys.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    out.find = find;
    out.findOne = findOne;
    out.query = query;
    out.insert = insert;
    out.update = update;
    out.upsert = upsert;
    out.delete = del;
    out.load = load;
    return out;
  });

  out.db = db;
  out.table = table;

  out.new = out.make = function(props) {
    if (!!props) {
      var p = {};
      for (var k in props) {
        if (!!props[k].value || typeof props[k].get === 'function' || typeof props[k].set === 'function') p[k] = props[k];
        else p[k] = { value: props[k], writable: true, configurable: true, enumerable: true };
      }
      return Object.create(out.prototype, p);
    }
    else return Object.create(out.prototype);
  };

  var find = function() {
    var q = norm(arguments);
    q.options.exclude = q.options.exclude || [];

    var hasCond = true;
    if (noText.test(q.query)) hasCond = false;

    q.query = 'SELECT ' + this.columns.
      filter(function(c) { return q.options.exclude.indexOf(c.name) === -1; }).
      map(function(c) { return ident(c.name); }).join(', ') +
        ' FROM ' + ident(table) +
        (hasCond ? (!startsWithOrder.test(q.query) && !startsWithWhere.test(q.query) ? ' WHERE ' : ' ') + q.query : '') + ';';

    var target = q.options.transaction || q.options.trans || q.options.t || q.options.db || db;

    return target.query(q).then(function(rs) {
      var cache = {};
      return _.map(rs.rows, function(r) {
        return out.load(r, { cache: cache });
      });
    });
  };
  out.find = function() { var args = arguments; return ready.then(function() { return find.apply(out, Array.prototype.slice.call(args, 0)); }); };

  var findOne = function() {
    var q = norm(arguments);
    q.options.exclude = q.options.exclude || [];

    var hasCond = true;
    if (noText.test(q.query)) hasCond = false;

    q.query = 'SELECT ' + this.columns.
      filter(function(c) { return q.options.exclude.indexOf(c.name) === -1; }).
      map(function(c) { return ident(c.name); }).join(', ') +
        ' FROM ' + ident(table) +
        (hasCond ? (!startsWithOrder.test(q.query) && !startsWithWhere.test(q.query) ? ' WHERE ' : ' ') + q.query : '') + ';';

    var target = q.options.transaction || q.options.trans || q.options.t || q.options.db || db;

    return target.queryOne(q).then(function(rs) {
      return out.load(rs);
    });
  };
  out.findOne = function() { var args = arguments; return ready.then(function() { return findOne.apply(out, Array.prototype.slice.call(args, 0)); }); };

  var query = function(/*ql, [params], [options]*/) {
    var args = Array.prototype.slice.call(arguments, 0);
    var q = norm(args);
    q.options = q.options || {};
    var qs = qlToQuery.call(this, { db: db, query: q.query, exclude: q.options.exclude });
    var k, fetch, found = false;
    q.query = qs.query;

    if (!q.options.hasOwnProperty('fetch')) {
      fetch = {};
      // look for fetch parameters
      for (k in qs.aliases) {
        if (q.options.hasOwnProperty(k)) {
          fetch[k] = q.options[k];
          delete q.options[k];
          found = true;
        }
      }
      if (found) q.options.fetch = fetch;
    }

    for (k in qs.aliases) if (qs.aliases[k] === out) q.options.alias = k;
    q.options.aliases = qs.aliases;

    var target = q.options.transaction || q.options.trans || q.options.t || q.options.db || db;

    return target.query(q).then(function(rs) {
      q.options.cache = {};
      return _.foldl(rs.rows, function(a, r) {
        var res = out.load(r, q.options);
        if (a.indexOf(res) < 0) a.push(res);
        return a;
      }, []);
    });
  };
  out.query = function() { var args = arguments; return ready.then(function() { return query.apply(out, Array.prototype.slice.call(args, 0)); }); };

  var stringType = /char|text/i;
  var insert = function(obj, opts) {
    opts = opts || {};
    var sql = 'INSERT INTO "' + table + '" (\n\t';
    var cols = [], params = [], fetch = [], tmp = {};
    var c, col, nm, columns = out.columns;
    for (nm in obj) tmp[nm] = obj[nm];
    for (c in columns) {
      col = columns[c];
      nm = tmp.hasOwnProperty(col.name) ? col.name : camelCase(col.name);
      if (tmp.hasOwnProperty(nm)) {
        cols.push(ident(col.name));
        if (tmp[nm] === '' && !stringType.test(col.type) && emptyStringToNull) params.push('null');
        else params.push('$' + nm + (!!c.cast ? '::' + c.cast : ''));

        if (col.json && !col.cast) tmp[nm] = JSON.stringify(tmp[nm]);
      } else if (col.elidable) {
        fetch.push(col.name);
      } else throw new Error('Missing non-elidable column ' + col.name + '.');
    }
    sql += cols.join(', ');
    sql += '\n) VALUES (\n\t';
    sql += params.join(', ') + '\n)';
    if (fetch.length > 0)
      sql += ' RETURNING ' + fetch.join(', ') + ';';

    var target = opts.transaction || opts.trans || opts.t || opts.db || db;

    if (fetch.length > 0) {
      return target.queryOne(sql, tmp).then(function(r) {
        for (var c in fetch) {
          obj[useCamelCase ? camelCase(fetch[c]) : fetch[c]] = r[fetch[c]];
        }
        obj._generated_loaded = true;
        return obj;
      });
    } else {
      return target.nonQuery(sql, obj).then(function(c) {
        if (c !== 1) new Error("Expected one row to be inserted rather than " + c + ".");

        delete obj._generated_last_values;
        obj._generated_last_values = _.cloneDeep(obj);
        obj._generated_loaded = true;
        return obj;
      });
    }
  };
  out.insert = function(obj, opts) { return ready.then(function() { return insert(obj, opts); }); };

  var update = function(obj, opts) {
    opts = opts || {};
    var sql = 'UPDATE "' + table + '" SET\n\t';
    var cols = [], cond = [], tmp = [], fetch = [];
    var c, col, nm, tnm, last, params = {};

    for (nm in obj) params[nm] = obj[nm];

    if (out.keys.length > 0) {
      for (c in out.columns) {
        col = out.columns[c];
        tnm = nm = params.hasOwnProperty(col.name) ? col.name : camelCase(col.name);
        if (out.keys.indexOf(col.name) < 0 && optConcur.indexOf(col.name) < 0) {
          if (params.hasOwnProperty(nm)) cols.push({ name: col.name, value: (params[nm] === '' && !stringType.test(col.type) && emptyStringToNull) ? 'null' : '$' + nm, cast: col.cast });

          if (col.json) params[nm] = JSON.stringify(params[nm]);
          // tell postgres-gen that this needs to be turned into ARRAY[...] instead of (...)
          else if (Array.isArray(params[nm])) params[nm].literalArray = true;
        } else {
          if (optConcur.indexOf(col.name) >= 0) {
            var v = concurVal(col.name);
            tnm = '_generated_' + col.name;
            params[tnm] = v;
            fetch.push({ name: nm, value: v });
            cols.push({ name: col.name, value: '$' + tnm, cast: col.cast });
          }
          cond.push({ name: col.name, value: nm });
        }
      }
    } else if (params.hasOwnProperty('_generated_last_values') || opts.lastValues) {
      last = opts.lastValues || params._generated_last_values;
      for (c in out.columns) {
        col = out.columns[c];
        nm = last.hasOwnProperty(col.name) ? col.name : camelCase(col.name);

        // TODO: optimistic concurrency for keyless tables
        if (params.hasOwnProperty(nm)) cols.push({ name: col.name, value: '$' + nm, cast: col.cast });

        if (col.json) params[nm] = JSON.stringify(params[nm]);
        // tell postgres-gen that this needs to be turned into ARRAY[...] instead of (...)
        else if (Array.isArray(params[nm])) params[nm].literalArray = true;

        if (last.hasOwnProperty(nm)) {
          cond.push({ name: col.name, value: '_last_' + nm });
          params['_last_' + nm] = last[nm];
        }
      }
    }

    if (cols.length === 0) throw new Error('Update called for object with no data to update.');

    for (c in cols) { tmp.push(ident(cols[c].name) + ' = ' + cols[c].value + (!!cols[c].cast ? '::' + cols[c].cast : '')); }
    sql += tmp.join(', ');
    sql += '\nWHERE\n\t';

    tmp = [];
    for (c in cond) {
      nm = cond[c].value;
      if (params[nm] === null || params[nm] === undefined) tmp.push(ident(cond[c].name) + ' is null');
      else tmp.push(ident(cond[c].name) + ' = $' + cond[c].value);
    }
    sql += tmp.join(' AND ') + ';';

    var target = opts.transaction || opts.trans || opts.t || opts.db || db;

    return target.nonQuery(sql, params).then(function(rs) {
      if (rs != 1) throw new Error('Wrong number of results. Expected 1. Got ' + rs + '.');
      var c;
      for (c in fetch) obj[fetch[c].name] = fetch[c].value;
      for (c in optConcur) {
        delete obj['_generated_' + optConcur[c]];
      }

      // keep last values up to date for keyless tables
      if (out.keys.length === 0) {
        delete obj._generated_last_values;
        if (last) {
          for (c in last) last[c] = obj[c];
          obj._generated_last_values = last;
        } else {
          obj._generated_last_values = _.cloneDeep(obj);
        }
      }
      return obj;
    });
  };
  out.update = function(obj, opts) { return ready.then(function() { return update(obj, opts); }); };

  var upsert = function(obj, opts) {
    if (!!obj._generated_loaded) return out.update(obj, opts);
    else {
      var i, res = true, keys = out.keys;

      if (keys.length === 0) {
        // upserting is not supported on keyless tables
        res = false;
      } else {
        // check for missing keys
        for (i = 0; res && i < keys.length; i++) {
          if (!obj.hasOwnProperty(camelCase(keys[i]))) res = false;
        }

        for (i = 0; res && i < optConcur.length; i++) {
          if (!obj.hasOwnProperty(camelCase(optConcur[i]))) res = false;
        }
      }

      if (res) return out.update(obj, opts);
      else return out.insert(obj, opts);
    }
  };
  out.upsert = function(obj, opts) { return ready.then(function() { return upsert(obj, opts); }); };

  var del = function() {
    var opts, target, c, name;
    if (arguments.length < 1) return Promise.reject('Refusing to empty the ' + table + ' table.');
    if (typeof arguments[0] === 'string') {
      var q = norm(Array.prototype.concat('DELETE FROM ' + ident(table) + ' WHERE ' + arguments[0], Array.prototype.slice.call(arguments, 1)));
      target = q.options.transaction || q.options.trans || q.options.t || q.options.db || db;
      return target.nonQuery(q);
    } else if (arguments[0].hasOwnProperty('_generated_loaded')) {
      var obj = arguments[0];
      opts = arguments[1] || {};
      var sql = 'DELETE FROM ' + ident(table) + ' WHERE\n\t';
      var params = [], hasQuery = false;

      if (out.keys.length > 0) {
        for (c in out.columns) {
          c = out.columns[c];
          name = obj.hasOwnProperty(c.name) ? c.name : camelCase(c.name);
          if (out.keys.indexOf(c.name) > -1 || optConcur.indexOf(c.name) > -1) {
            if (hasQuery) sql += ' AND ';
            hasQuery = true;

            if (obj[name] === null || obj[name] === undefined) sql += ident(c.name) + ' is null';
            else {
              sql += ident(c.name) + ' = ?';
              params.push(obj[name]);
            }
          }
        }
      } else if (obj.hasOwnProperty('_generated_last_values') || opts.lastValues) {
        var last = opts.lastValues || obj._generated_last_values;
        for (c in out.columns) {
          c = out.columns[c];
          name = last.hasOwnProperty(c.name) ? c.name : camelCase(c.name);
          if (last.hasOwnProperty(name)) {
            if (hasQuery) sql += ' AND ';
            hasQuery = true;

            if (last[name] === null || last[name] === undefined) sql += ident(c.name) + ' is null';
            else {
              sql += ident(c.name) + ' = ?';
              params.push(last[name]);
            }
          }
        }
      }
      sql += ';';

      if (!hasQuery) return Promise.reject(new Error('Can\'t identify this object in the database.'));

      var next = function*() {
        var count = yield db.nonQuery(sql, params);
        if (count !== 1) throw new Error('Expected to delete 1 record, but instead tried to delete ' + count + '.');
        delete obj._generated_loaded;
        return count;
      };

      return (opts.transaction || opts.trans || opts.t || opts.db || db).transaction(next);
    }
  };
  out.delete = out.del = function() { var args = arguments; return ready.then(function() { return del.call(out, Array.prototype.slice.call(args, 0)); }); };

  out.aliasColumns = function(alias) {
    var cols = [];
    for (var c in out.columns) {
      cols.push(ident(alias) + '.' + ident(out.columns[c].name) + ' AS ' + ident('_' + alias + '__' + out.columns[c].name));
    }
    return cols.join(', ');
  };

  var load = (function() {
    // TODO: this could really use some caching, especially for large datasets
    var fromObject = function(target, obj, rec, cache, aliases, extra) {
      var k, v, dao, res, ex;
      extra = extra || {};
      for (k in obj) {
        res = null;
        v = obj[k];
        dao = aliases[k];

        if (!!!dao) continue;

        // allow extra processors to be passed along
        ex = extra;
        if (ex[k]) ex = ex[k];

        if (typeof v === 'string') { // one-to-one simple
          res = dao.load(rec, { cache: cache, aliases: aliases, alias: k, extra: extra });
          if (!!res) target[k] = res;
        } else if (Array.isArray(v) && v.length <= 1) { // one-to-many
          if (!!!target[k] || !Array.isArray(target[k])) target[k] = [];
          res = dao.load(rec, { cache: cache, aliases: aliases, alias: k, fetch: v[0], extra: extra });
          if (!!res) target[k].push(res);
        } else if (typeof v === 'object') { // one-to-one complex
          res = dao.load(rec, { cache: cache, aliases: aliases, alias: k, fetch: v, extra: extra });
          if (!!res) target[k] = res;
        }
      }
    };
    return function(rec, options) {
      options = options || {};
      var alias = (!!options.alias ? '_' + options.alias + '__' : '');
      if (!_.reduce(out.keys, function(a, c) { return a && !!rec[alias + c]; }, true)) return null;
      var c, col, res;
      var aliases = options.aliases || {};
      var lookup = cacheName(_.map(out.keys, function(k) { return rec[alias + k]; }));
      var cache = options.cache || {};

      if (lookup !== '' && cache.hasOwnProperty(lookup)) res = cache[lookup];

      if (!!!res) {
        res = out.new();
        res._generated_loaded = true;
        for (c in out.columns) {
          col = out.columns[c].name;
          res[camelCase(col)] = rec[alias + col];
        }

        // cache the value if possible and save the current values if not, since it's a keyless table
        if (lookup !== '') cache[lookup] = res;
        else res._generated_last_values = _.cloneDeep(res);
      }

      // run any extra handlers
      if (!!options.extra && typeof options.extra === 'function') options.extra.call(this, rec, res, options);
      else if (!!options.extra && typeof options.extra[options.alias] === 'function') options.extra[options.alias].call(this, rec, res, options);

      if (!!options.fetch) {
        fromObject(res, options.fetch, rec, cache, aliases, options.extra);
      }

      return res;
    };
  })();
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
