// Test-only Supabase-shaped adapter executing the production repository's queries
// against isolated real PostgreSQL (PGlite), not against the configured project.
export function postgresClient(db) {
  const identifier = (name) => {
    if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid test identifier');
    return `"${name}"`;
  };
  async function execute(sql, params) {
    try { return { data: (await db.query(sql, params)).rows, error: null }; }
    catch (error) { return { data: null, error: { code: error.code } }; }
  }
  return {
    async rpc(name, args) {
      const result = await execute(`select public.${identifier(name)}(${Object.keys(args).map((key, i) =>
        `${identifier(key)} => $${i + 1}`).join(',')}) as value`, Object.values(args).map(value =>
        typeof value === 'object' ? JSON.stringify(value) : value));
      return { data: result.data?.[0]?.value, error: result.error };
    },
    from(table) {
      let columns = '*', update, filters = [];
      const query = {
        select(value) { columns = value === '*' ? '*' : identifier(value); return query; },
        update(value) { update = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        async maybeSingle() {
          const result = await query;
          return { data: result.data?.[0] || null, error: result.error };
        },
        then(resolve, reject) {
          const params = update ? Object.values(update) : [];
          let sql = update ? `update public.${identifier(table)} set ${Object.keys(update).map((key, i) => `${identifier(key)}=$${i + 1}`).join(',')}`
            : `select ${columns} from public.${identifier(table)}`;
          sql += ' where ' + filters.map(([key, value]) => { params.push(value); return `${identifier(key)}=$${params.length}`; }).join(' and ');
          return execute(sql, params).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
