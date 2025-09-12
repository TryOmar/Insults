import stringWidth from 'string-width';

export interface TableConfig {
  columns: Array<{ maxWidth: number }>, // Removed align property
  emptyMessage: string;
  maxTableWidth?: number; // Total maximum width for the entire table (default: 35)
}

export function renderTable(headers: string[], rows: string[][], config?: TableConfig): string {
  if (rows.length === 0) {
    return '```text\n' + (config?.emptyMessage || 'No data to display') + '\n```';
  }

  // Calculate column widths based on percentage of total maxWidth
  const maxTableWidth = config?.maxTableWidth || 35;
  
  // Get the sum of all maxWidth values
  const totalMaxWidth = config?.columns?.reduce((sum, col) => sum + col.maxWidth, 0) || 
    headers.length * 8; // Fallback: assume 8 for each column if no config
  
  // Calculate actual column widths as percentages of maxTableWidth
  const columnWidths: number[] = headers.map((header, colIndex) => {
    const maxWidth = config?.columns?.[colIndex]?.maxWidth || 8;
    const percentage = maxWidth / totalMaxWidth;
    const calculatedWidth = Math.floor(percentage * maxTableWidth);
    
    // Ensure minimum width of 1 and maximum of maxTableWidth
    return Math.max(1, Math.min(calculatedWidth, maxTableWidth));
  });
  
  // Adjust for borders and separators (each column has 2 spaces for padding + 1 for separator)
  const totalBorderWidth = headers.length * 3 + 1; // 3 per column + 1 for final border
  const availableWidth = maxTableWidth - totalBorderWidth;
  
  // If we exceed available width, scale down proportionally
  const currentTotal = columnWidths.reduce((sum, width) => sum + width, 0);
  if (currentTotal > availableWidth) {
    const scaleFactor = availableWidth / currentTotal;
    columnWidths.forEach((width, index) => {
      columnWidths[index] = Math.max(1, Math.floor(width * scaleFactor));
    });
  }

  // Normalize all fields with Left-to-Right Mark for consistent alignment
  function normalizeCell(text: string): string {
    if (!text) return '\u200E';

    // Always add Left-to-Right Mark to ensure consistent text alignment
    return '\u200E' + text.trim();
  }

  // Pad + truncate text safely with consistent Left-to-Right alignment
  const padText = (text: string, width: number): string => {
    let str = text ?? '';

    // Truncate if too wide (no ellipsis indicator)
    if (stringWidth(str) > width) {
      str = str.slice(0, str.length - 1);
      while (stringWidth(str) > width) {
        str = str.slice(0, str.length - 1);
      }
    }

    const padSize = width - stringWidth(str);

    // Always use Left-to-Right Mark for consistent alignment
    return '\u200E' + str + ' '.repeat(padSize);
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
      let content = normalizeCell(cell || '');
      return padText(content, columnWidths[i]);
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
