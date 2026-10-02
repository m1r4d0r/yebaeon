// Observe the query results already produced by D1. No extra measurement queries.
export function measuredDB(db, route) {
  const costs = new Map(), originals = new WeakMap();
  function record(sql, result) {
    let hash = 2166136261;
    for (const c of sql) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    const id = (hash >>> 0).toString(16), old = costs.get(id) || {query: id, calls: 0, rowsRead: 0, rowsWritten: 0};
    old.calls++; old.rowsRead += result.meta?.rows_read || 0; old.rowsWritten += result.meta?.rows_written || 0; costs.set(id, old);
    return result;
  }
  function wrap(statement, sql) {
    const wrapped = {
      bind(...args) { return wrap(statement.bind(...args), sql); },
      async all() { return record(sql, await statement.all()); },
      async run() { return record(sql, await statement.run()); },
      async first(column) { const result = await wrapped.all(); const row = result.results[0] || null; return column && row ? row[column] : row; }
    };
    originals.set(wrapped, {statement, sql}); return wrapped;
  }
  return {
    rawDB: db,
    metrics() { return [...costs.values()].map(c=>({...c})); },
    prepare(sql) { return wrap(db.prepare(sql), sql); },
    async batch(statements) {
      const raw = statements.map(s => originals.get(s));
      const results = await db.batch(raw.map(s => s.statement));
      return results.map((r, i) => record(raw[i].sql, r));
    },
    report() { if (costs.size) console.log(JSON.stringify({event:'d1-request-cost', route, queries:[...costs.values()]})); }
  };
}
