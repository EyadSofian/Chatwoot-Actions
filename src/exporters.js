export function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const flatRows = rows.map(row => flattenObject(row));
  const headers = [...new Set(flatRows.flatMap(row => Object.keys(row)))];
  const lines = [headers.join(",")];

  for (const row of flatRows) {
    lines.push(headers.map(header => csvCell(row[header])).join(","));
  }

  return lines.join("\n");
}

export function flattenObject(value, prefix = "", output = {}) {
  if (value === null || value === undefined) {
    output[prefix || "value"] = "";
    return output;
  }

  if (Array.isArray(value)) {
    output[prefix || "value"] = JSON.stringify(value);
    return output;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      flattenObject(nested, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }

  output[prefix || "value"] = value;
  return output;
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
