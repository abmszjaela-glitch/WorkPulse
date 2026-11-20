// Quote every field and neutralize spreadsheet formula execution, including leading whitespace.
export function csv(rows, columns) {
  const cell = (value) => {
    let text = value == null ? '' : String(value);
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [columns.map(([name]) => cell(name)).join(','),
    ...rows.map(row => columns.map(([, key]) => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
