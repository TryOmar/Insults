import stringWidth from 'string-width';

export interface TableConfig {
  columns: Array<{ maxWidth: number; align: 'left' | 'right' }>,
  emptyMessage: string;
}

export function renderTable(headers: string[], rows: string[][], config?: TableConfig): string {
  if (rows.length === 0) {
    return '```text\n' + (config?.emptyMessage || 'No data to display') + '\n```';
  }

  // Use maxWidth from config if provided, otherwise fallback to defaults
  const columnWidths: number[] = headers.map((header, colIndex) => {
    const headerWidth = stringWidth(header);
    const maxRowWidth = Math.max(...rows.map(row => stringWidth(row[colIndex] || '')));
    const contentWidth = Math.max(headerWidth, maxRowWidth);
    const maxAllowed = config?.columns?.[colIndex]?.maxWidth || 8; // Default max width
    return Math.min(contentWidth, maxAllowed);
  });

  // Normalize Arabic-only fields
  function normalizeCell(text: string): string {
    if (!text) return '';

    // Detect pure Arabic text (basic Arabic unicode range)
    const isArabic = /^[\u0600-\u06FF\s]+$/.test(text);

    if (isArabic) {
      // Force Left-to-Right rendering without adding visible junk
      return '\u200E' + text;
    }

    return text;
  }

  // Pad + truncate text safely (Arabic + wide chars supported)
  const padText = (text: string, width: number, align: 'left' | 'right' = 'left'): string => {
    let str = text ?? '';

    // Truncate if too wide
    if (stringWidth(str) > width) {
      str = str.slice(0, str.length - 1);
      while (stringWidth(str) > width - 1) {
        str = str.slice(0, str.length - 1);
      }
      str += '…';
    }

    const padSize = width - stringWidth(str);
    return align === 'right' ? ' '.repeat(padSize) + str : str + ' '.repeat(padSize);
  };

  // Borders
  const topBorder = '╔' + columnWidths.map(w => '═'.repeat(w + 2)).join('╦') + '╗';
  const middleBorder = '╠' + columnWidths.map(w => '═'.repeat(w + 2)).join('╬') + '╣';
  const bottomBorder = '╚' + columnWidths.map(w => '═'.repeat(w + 2)).join('╩') + '╝';

  // Header row
  const headerRow = '║ ' + headers.map((header, i) =>
    padText(header, columnWidths[i], config?.columns?.[i]?.align || 'left')
  ).join(' ║ ') + ' ║';

  // Data rows
  const dataRows = rows.map(row =>
    '║ ' + row.map((cell, i) => {
      let content = normalizeCell(cell || '');
      return padText(content, columnWidths[i], config?.columns?.[i]?.align || 'left');
    }).join(' ║ ') + ' ║'
  );

  // Combine
  const table = [
    topBorder,
    headerRow,
    middleBorder,
    ...dataRows,
    bottomBorder
  ].join('\n');

  return '```text\n' + table + '\n```';
}
