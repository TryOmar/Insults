import stringWidth from 'string-width';

export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return '```text\nNo data to display\n```';
  }

  // Define maximum column widths to fit Discord's character limit
  const maxColumnWidths = {
    0: 4,  // ID column
    1: 12, // Insult column
    2: 8,  // Note column
    3: 10, // Blamer column
    4: 8   // When column
  };

  // Calculate actual column widths (min of content width and max width)
  const columnWidths: number[] = headers.map((header, colIndex) => {
    const headerWidth = stringWidth(header);
    const maxRowWidth = Math.max(...rows.map(row => stringWidth(row[colIndex] || '')));
    const contentWidth = Math.max(headerWidth, maxRowWidth);
    const maxAllowed = maxColumnWidths[colIndex as keyof typeof maxColumnWidths] || 8;
    return Math.min(contentWidth, maxAllowed);
  });

  // Normalize Arabic-only fields
 // Normalize Arabic cells by forcing LTR direction
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
    padText(header, columnWidths[i])
  ).join(' ║ ') + ' ║';

  // Data rows
  const dataRows = rows.map(row =>
    '║ ' + row.map((cell, i) => {
      let content = normalizeCell(cell || '', i);

      // Special handling
      if (i === 3 && content.startsWith('@') && stringWidth(content) > columnWidths[i]) {
        // Keep '@' visible
        content = '@' + content.slice(1, content.length - 1) + '…';
      }

      return padText(content, columnWidths[i], i === 0 ? 'right' : 'left');
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
