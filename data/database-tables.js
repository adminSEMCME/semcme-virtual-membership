const tables = new Set([
  'registrations', 'members', 'support_requests', 'magic_links',
  'library_programs', 'library_resources', 'settings', 'imported_programs',
]);

// Only SQL identifier tokens are changed; values, comments and parameters are preserved.
export function prefixTables(statement, prefix = '') {
  if (!['', 'vm_'].includes(prefix)) throw new Error('DATABASE_TABLE_PREFIX must be empty or vm_.');
  if (!prefix) return statement;
  return statement.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\b[a-zA-Z_][a-zA-Z_0-9]*\b/g, token => {
    if (tables.has(token)) return prefix + token;
    if (token.startsWith('"') && tables.has(token.slice(1, -1))) return '"' + prefix + token.slice(1);
    return token;
  });
}
