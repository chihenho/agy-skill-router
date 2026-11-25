function unquoteYamlScalar(val) {
  if (val.startsWith('"') && val.endsWith('"')) {
    try {
      return JSON.parse(val);
    } catch {
      return val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1).replace(/''/g, "'");
  }
  return val;
}

function parseInlineArray(val) {
  const inner = val.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => unquoteYamlScalar(s.trim()))
    .filter(Boolean);
}

export function parseSkillMarkdown(raw) {
  const normalized = String(raw || "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fields = {};
  let body = normalized;

  if (match) {
    body = match[2];
    const lines = match[1].split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!keyMatch) {
        i += 1;
        continue;
      }

      const key = keyMatch[1];
      let val = keyMatch[2].trim();

      if (/^[>|][+-]?$/.test(val)) {
        const style = val[0];
        const blockLines = [];
        i += 1;
        while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === "")) {
          blockLines.push(lines[i].replace(/^\s{2,}/, "").trimEnd());
          i += 1;
        }
        val =
          style === ">"
            ? blockLines.join(" ").replace(/\s+/g, " ").trim()
            : blockLines.join("\n").trim();
      } else if (val === "") {
        const listItems = [];
        const contLines = [];
        i += 1;
        while (i < lines.length && /^\s+/.test(lines[i])) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith("- ")) {
            listItems.push(unquoteYamlScalar(trimmed.slice(2).trim()));
          } else if (trimmed) {
            contLines.push(trimmed);
          }
          i += 1;
        }
        val = listItems.length > 0 ? listItems : contLines.join(" ");
      } else if (val.startsWith("[") && val.endsWith("]")) {
        val = parseInlineArray(val);
        i += 1;
      } else {
        val = unquoteYamlScalar(val);
        i += 1;
      }

      fields[key] = val;
    }
  }

  const headings = [];
  for (const line of body.split("\n")) {
    const h = line.match(/^#{1,2}\s+(.+)$/);
    if (h) {
      headings.push(h[1].replace(/[`*_~[\]()]/g, " ").trim());
      if (headings.length >= 12) break;
    }
  }

  const tagsRaw = fields.tags || fields.keywords || [];
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).trim()).filter(Boolean)
    : String(tagsRaw)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

  const statusVal = String(fields.status || "").toLowerCase();
  const deprecated =
    String(fields.deprecated || "").toLowerCase() === "true" ||
    statusVal === "deprecated" ||
    statusVal === "obsolete";

  return {
    name: typeof fields.name === "string" ? fields.name.trim() : "",
    description: typeof fields.description === "string" ? fields.description.replace(/\s+/g, " ").trim() : "",
    tags,
    headings,
    deprecated,
    rawBody: body,
  };
}
